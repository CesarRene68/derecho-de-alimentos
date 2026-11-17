/* ==========================================================================
   lib/autenticacion.js — Sesión del panel de administración.
   --------------------------------------------------------------------------
   Se importa desde las Pages Functions. Usa solo Web Crypto (sin librerías):

     - ADMIN_PASSWORD_HASH: PBKDF2-SHA256 con sal, guardado como secreto.
       Formato: pbkdf2$<iteraciones>$<sal-base64url>$<hash-base64url>
     - SESSION_TOKEN: HMAC-SHA256 firmado con SESSION_SECRET (también secreto)
       y caducidad de 12 horas, enviado en una cookie HttpOnly.

   La contraseña NUNCA viaja en la URL ni se guarda en el repositorio.
   ========================================================================== */

'use strict';

const NOMBRE_COOKIE = 'sesion_admin';
const DURACION_SESION = 12 * 60 * 60; /* segundos */
const ITERACIONES_MINIMAS = 100000;
/* Cloudflare Workers solo admite PBKDF2 hasta 100000 iteraciones. */
const ITERACIONES_MAXIMAS = 100000;

/* --------------------------------------------------------------------------
   Base64url (seguro para URLs y cookies)
   -------------------------------------------------------------------------- */

function aBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let cadena = '';

  for (const byte of bytes) cadena += String.fromCharCode(byte);

  return btoa(cadena)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function deBase64Url(texto) {
  /* Ignora saltos de línea/espacios: Wrangler puede añadirlos al guardar
     el secreto. Sin esto, el hash cambia y toda contraseña parece errónea. */
  const normalizado = String(texto || '')
    .replace(/\s+/g, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const sobrante = normalizado.length % 4;
  const completo = normalizado + (sobrante ? '='.repeat(4 - sobrante) : '');
  const binario = atob(completo);
  const bytes = new Uint8Array(binario.length);

  for (let indice = 0; indice < binario.length; indice += 1) {
    bytes[indice] = binario.charCodeAt(indice);
  }

  return bytes;
}

/* --------------------------------------------------------------------------
   Contraseña
   -------------------------------------------------------------------------- */

function derivarBits(contrasena, sal, iteraciones) {
  const claveBase = crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(contrasena),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  return claveBase.then(function (clave) {
    return crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: iteraciones },
      clave,
      256
    );
  });
}

/** Compara la contraseña recibida con el hash guardado en el secreto. */
export async function verificarContrasena(contrasena, valorGuardado) {
  try {
    const partes = String(valorGuardado || '').trim().split('$');

    if (partes.length !== 4 || partes[0] !== 'pbkdf2') return false;

    const iteraciones = Number(partes[1]);
    if (!Number.isInteger(iteraciones) ||
        iteraciones < ITERACIONES_MINIMAS ||
        iteraciones > ITERACIONES_MAXIMAS) {
      return false;
    }

    const sal = deBase64Url(partes[2]);
    const esperado = deBase64Url(partes[3]);

    /* Longitudes fijas: evita comparar buffers de tamaños distintos. */
    if (sal.byteLength !== 16 || esperado.byteLength !== 32) return false;

    const calculado = new Uint8Array(
      await derivarBits(String(contrasena || ''), sal, iteraciones)
    );

    /* Comparación propia: timingSafeEqual de Workers no acepta Uint8Array
       de forma fiable y hacía que toda contraseña pareciera incorrecta. */
    let diferencia = 0;
    const longitud = Math.max(calculado.byteLength, esperado.byteLength);
    for (let indice = 0; indice < longitud; indice += 1) {
      diferencia |= (calculado[indice] || 0) ^ (esperado[indice] || 0);
    }
    return diferencia === 0;
  } catch (error) {
    return false;
  }
}

/* --------------------------------------------------------------------------
   Token de sesión
   -------------------------------------------------------------------------- */

function claveHmac(secreto) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secreto),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

/** Crea un token firmado con caducidad. */
export async function crearTokenSesion(secreto, ahora) {
  const instante = Number(ahora) || Date.now();
  const aleatorio = crypto.getRandomValues(new Uint8Array(12));
  const cuerpo = {
    v: 1,
    exp: Math.floor(instante / 1000) + DURACION_SESION,
    n: aBase64Url(aleatorio)
  };
  const datos = new TextEncoder().encode(JSON.stringify(cuerpo));
  const firma = await crypto.subtle.sign('HMAC', await claveHmac(secreto), datos);

  return aBase64Url(datos) + '.' + aBase64Url(firma);
}

/** Valida la firma y la caducidad del token. */
export async function verificarTokenSesion(token, secreto, ahora) {
  try {
    const partes = String(token || '').split('.');
    if (partes.length !== 2) return false;

    const datos = deBase64Url(partes[0]);
    const firma = deBase64Url(partes[1]);
    const firmaValida = await crypto.subtle.verify(
      'HMAC',
      await claveHmac(secreto),
      firma,
      datos
    );

    if (!firmaValida) return false;

    const cuerpo = JSON.parse(new TextDecoder().decode(datos));
    const expira = Number(cuerpo && cuerpo.exp);
    const instante = Number(ahora) || Date.now();

    return cuerpo.v === 1 && Number.isFinite(expira) &&
      expira > Math.floor(instante / 1000);
  } catch (error) {
    return false;
  }
}

/* --------------------------------------------------------------------------
   Cookie y guardas de las rutas
   -------------------------------------------------------------------------- */

/** Lee una cookie concreta de la cabecera Cookie. */
export function leerCookie(request, nombre) {
  const cabecera = request.headers.get('Cookie') || '';

  for (const parte of cabecera.split(';')) {
    const trozos = parte.trim().split('=');
    if (trozos[0] === nombre) return trozos.slice(1).join('=');
  }

  return '';
}

/**
 * Genera la cabecera Set-Cookie. En localhost se omite Secure para poder
 * probar con http://; en producción la cookie siempre es Secure.
 */
export function construirCookieSesion(token, request) {
  const host = new URL(request.url).hostname;
  const seguro = host === 'localhost' || host === '127.0.0.1' ? '' : 'Secure; ';

  return NOMBRE_COOKIE + '=' + token + '; HttpOnly; ' + seguro +
    'SameSite=Strict; Path=/; Max-Age=' + DURACION_SESION;
}

/** Cabecera para borrar la cookie al cerrar sesión. */
export function construirCookieVacia(request) {
  const host = new URL(request.url).hostname;
  const seguro = host === 'localhost' || host === '127.0.0.1' ? '' : 'Secure; ';

  return NOMBRE_COOKIE + '=; HttpOnly; ' + seguro +
    'SameSite=Strict; Path=/; Max-Age=0';
}

/** true cuando la petición trae una sesión firmada y vigente. */
export async function esSesionValida(request, env) {
  if (!env || !env.SESSION_SECRET) return false;

  const token = leerCookie(request, NOMBRE_COOKIE);
  if (!token) return false;

  return verificarTokenSesion(token, env.SESSION_SECRET);
}

/**
 * Devuelve una respuesta 401 cuando no hay sesión, o null cuando sí la hay.
 * Se usa al inicio de cada handler del API del panel.
 */
export async function exigirSesion(request, env) {
  if (await esSesionValida(request, env)) return null;

  return Response.json(
    { error: 'Debes iniciar sesión para realizar esta acción.' },
    { status: 401, headers: { 'Cache-Control': 'no-store' } }
  );
}

/**
 * Defiende las peticiones que escriben contra peticiones entre sitios.
 * SameSite=Strict ya bloquea la cookie; esta comprobación es una capa extra.
 */
export function origenValido(request) {
  const origen = request.headers.get('Origin');
  if (!origen) return true;

  try {
    return new URL(origen).origin === new URL(request.url).origin;
  } catch (error) {
    return false;
  }
}
