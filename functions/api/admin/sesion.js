/* ==========================================================================
   functions/api/admin/sesion.js — Acceso al panel de administración.
   --------------------------------------------------------------------------
   POST   /api/admin/sesion   → comprueba la contraseña y crea la cookie.
   GET    /api/admin/sesion   → indica si hay una sesión vigente.
   DELETE /api/admin/sesion   → borra la cookie (cerrar sesión).

   La contraseña se compara con el hash guardado en ADMIN_PASSWORD_HASH
   (secreto de Pages). Los intentos fallidos se limitan con la tabla D1
   creada en migrations/0002_admin_intentos.sql.
   ========================================================================== */

'use strict';

import {
  verificarContrasena,
  crearTokenSesion,
  construirCookieSesion,
  construirCookieVacia,
  esSesionValida,
  origenValido
} from '../../../lib/autenticacion.js';

const CUERPO_MAXIMO = 2000;
const MAX_INTENTOS = 5;
const VENTANA_SEGUNDOS = 15 * 60;

/** Respuesta JSON sin caché. */
function responder(datos, estado, cabeceras) {
  return Response.json(datos, {
    status: estado || 200,
    headers: Object.assign(
      { 'Cache-Control': 'no-store' },
      cabeceras || {}
    )
  });
}

/** Lee un JSON pequeño; devuelve null si no es válido o es demasiado grande. */
async function leerCuerpo(request) {
  try {
    const texto = await request.text();
    if (texto.length > CUERPO_MAXIMO) return null;
    return JSON.parse(texto);
  } catch (error) {
    return null;
  }
}

/** Hash de la IP con el secreto: no guardamos la IP en claro en la BD. */
async function hashIp(request, secreto) {
  const cabecera = request.headers.get('CF-Connecting-IP') ||
    request.headers.get('x-forwarded-for') || 'sin-ip';
  const ip = cabecera.split(',')[0].trim();
  const datos = new TextEncoder().encode(secreto + '|' + ip);
  const resumen = await crypto.subtle.digest('SHA-256', datos);

  return Array.from(new Uint8Array(resumen))
    .map(function (byte) { return byte.toString(16).padStart(2, '0'); })
    .join('');
}

/** Cuenta los intentos fallidos recientes y aplica el límite. */
async function comprobarLimite(db, ipHash, ahora) {
  const fila = await db.prepare(
    'SELECT intentos, ultimo_intento FROM admin_intentos WHERE ip_hash = ?'
  ).bind(ipHash).first();

  const reciente = fila && Number(fila.ultimo_intento) > ahora - VENTANA_SEGUNDOS;
  const intentos = reciente ? Number(fila.intentos) || 0 : 0;

  if (intentos >= MAX_INTENTOS) {
    const espera = Math.max(1, VENTANA_SEGUNDOS - (ahora - Number(fila.ultimo_intento)));
    return { permitido: false, intentos: intentos, espera: espera };
  }

  return { permitido: true, intentos: intentos };
}

/** Registra un intento fallido (o reinicia la ventana si ya expiró). */
function registrarFallo(db, ipHash, intentos, ahora) {
  return db.prepare(
    'INSERT INTO admin_intentos (ip_hash, intentos, ultimo_intento) ' +
    'VALUES (?, ?, ?) ' +
    'ON CONFLICT(ip_hash) DO UPDATE SET ' +
    'intentos = excluded.intentos, ultimo_intento = excluded.ultimo_intento'
  ).bind(ipHash, intentos + 1, ahora).run();
}

/* --------------------------------------------------------------------------
   POST — Iniciar sesión
   -------------------------------------------------------------------------- */
export const onRequestPost = async (context) => {
  const request = context.request;
  const env = context.env;

  if (!origenValido(request)) {
    return responder({ error: 'Origen no permitido.' }, 403);
  }

  if (!env || !env.ADMIN_PASSWORD_HASH || !env.SESSION_SECRET) {
    return responder(
      { error: 'La autenticación no está configurada. Revisa los secretos ADMIN_PASSWORD_HASH y SESSION_SECRET.' },
      500
    );
  }

  if (!env.DB) {
    return responder({ error: 'Base de datos no configurada.' }, 500);
  }

  const datos = await leerCuerpo(request);
  const contrasena = String(datos && datos.password || '');

  if (!contrasena) {
    return responder({ error: 'Escribe la contraseña.' }, 400);
  }

  const ahora = Math.floor(Date.now() / 1000);

  try {
    const ipHash = await hashIp(request, env.SESSION_SECRET);
    const limite = await comprobarLimite(env.DB, ipHash, ahora);

    if (!limite.permitido) {
      return responder(
        { error: 'Demasiados intentos fallidos. Inténtalo de nuevo en unos minutos.' },
        429,
        { 'Retry-After': String(limite.espera) }
      );
    }

    const correcta = await verificarContrasena(contrasena, env.ADMIN_PASSWORD_HASH);

    if (!correcta) {
      await registrarFallo(env.DB, ipHash, limite.intentos, ahora);
      return responder({ error: 'Contraseña incorrecta.' }, 401);
    }

    /* Login correcto: limpiamos el contador y emitimos la cookie firmada. */
    await env.DB.prepare('DELETE FROM admin_intentos WHERE ip_hash = ?')
      .bind(ipHash).run();

    const token = await crearTokenSesion(env.SESSION_SECRET);

    return responder(
      { ok: true },
      200,
      { 'Set-Cookie': construirCookieSesion(token, request) }
    );
  } catch (error) {
    console.error('Error en el acceso al panel:',
      error && error.message ? error.message : error);
    return responder({ error: 'No se pudo completar el acceso.' }, 500);
  }
};

/* --------------------------------------------------------------------------
   GET — Estado de la sesión
   -------------------------------------------------------------------------- */
export const onRequestGet = async (context) => {
  const autenticado = await esSesionValida(context.request, context.env);
  return responder({ autenticado: autenticado });
};

/* --------------------------------------------------------------------------
   DELETE — Cerrar sesión
   -------------------------------------------------------------------------- */
export const onRequestDelete = async (context) => {
  const request = context.request;

  if (!origenValido(request)) {
    return responder({ error: 'Origen no permitido.' }, 403);
  }

  return responder(
    { ok: true },
    200,
    { 'Set-Cookie': construirCookieVacia(request) }
  );
};
