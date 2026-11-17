/* ==========================================================================
   functions/api/admin/entradas.js — API del panel de administración.
   --------------------------------------------------------------------------
   Rutas (todas bajo /api/admin/entradas):

     GET    /api/admin/entradas          → lista todas las entradas
     POST   /api/admin/entradas          → crea una entrada
     PATCH  /api/admin/entradas          → edita una entrada (id en el JSON)
     DELETE /api/admin/entradas?id=1     → borra una entrada

   🔒 SEGURIDAD:
   Todas las rutas exigen una sesión firmada (cookie HttpOnly creada en
   /api/admin/sesion con la contraseña del panel). No dependemos de que
   Cloudflare Access esté configurado en el dashboard.

   El panel solo envía Título y Contenido. Aquí se derivan el resumen
   y las claves, y se guarda todo con prepared statements.
   Los disparadores de la BD actualizan el índice FTS5 automáticamente.
   ========================================================================== */

'use strict';

import {
  derivarResumen,
  derivarClaves
} from '../../../lib/contenido.js';

import {
  exigirSesion,
  origenValido
} from '../../../lib/autenticacion.js';

/* Longitud máxima del cuerpo de la petición (200 KB). */
const CUERPO_MAXIMO = 200000;

/** Registra el mensaje real de D1 (el objeto Error sale vacío en el tail). */
function registrarError(etiqueta, error) {
  console.error(etiqueta, error && error.message ? error.message : error);
  if (error && error.cause && error.cause.message) {
    console.error(etiqueta + ' (causa)', error.cause.message);
  }
}

/** Respuesta JSON con cabeceras que evitan cachear datos del panel. */
function responder(datos, estado) {
  return Response.json(datos, {
    status: estado || 200,
    headers: { 'Cache-Control': 'no-store' }
  });
}

/** Lee y parsea el JSON de la petición, con límite de tamaño. */
async function leerCuerpo(request) {
  try {
    const texto = await request.text();

    if (texto.length > CUERPO_MAXIMO) return null;
    return JSON.parse(texto);
  } catch (error) {
    return null;
  }
}

/**
 * Valida los dos únicos campos del formulario y devuelve un mensaje
 * de error entendible o los textos limpios.
 */
function validar(datos) {
  const titulo = String(datos && datos.titulo || '').trim();
  const contenido = String(datos && datos.contenido || '').trim();

  if (titulo.length < 3 || titulo.length > 200) {
    return { error: 'El título debe tener entre 3 y 200 caracteres.' };
  }

  if (contenido.length < 10 || contenido.length > 100000) {
    return { error: 'El contenido debe tener entre 10 y 100000 caracteres.' };
  }

  return { titulo: titulo, contenido: contenido };
}

/** Comprueba que el binding de D1 exista (🔧 se conecta en wrangler.jsonc). */
function obtenerDB(env) {
  return env && env.DB ? env.DB : null;
}

/* --------------------------------------------------------------------------
   GET — Listar entradas
   -------------------------------------------------------------------------- */
export const onRequestGet = async (context) => {
  const sinSesion = await exigirSesion(context.request, context.env);
  if (sinSesion) return sinSesion;

  const db = obtenerDB(context.env);

  if (!db) return responder({ error: 'Base de datos no configurada.' }, 500);

  /* Con ?id= se devuelve UNA entrada con el contenido completo; sirve para
     rellenar el formulario al pulsar "Editar". Sin id se devuelve el listado. */
  const id = Number(new URL(context.request.url).searchParams.get('id'));

  try {
    if (Number.isInteger(id) && id > 0) {
      const entrada = await db.prepare(
        'SELECT id, titulo, resumen, contenido, url, claves ' +
        'FROM articulos WHERE id = ?'
      ).bind(id).first();

      if (!entrada) return responder({ error: 'La entrada no existe.' }, 404);
      return responder({ ok: true, entrada: entrada });
    }

    const resultado = await db.prepare(
      'SELECT id, titulo, resumen, created_at ' +
      'FROM articulos ORDER BY id DESC LIMIT 200'
    ).all();

    return responder({
      ok: true,
      total: (resultado.results || []).length,
      entradas: resultado.results || []
    });
  } catch (error) {
    registrarError('Error al listar entradas:', error);
    return responder({ error: 'No se pudo leer la base de datos.' }, 500);
  }
};

/* --------------------------------------------------------------------------
   POST — Crear entrada
   -------------------------------------------------------------------------- */
export const onRequestPost = async (context) => {
  const sinSesion = await exigirSesion(context.request, context.env);
  if (sinSesion) return sinSesion;

  if (!origenValido(context.request)) {
    return responder({ error: 'Origen no permitido.' }, 403);
  }

  const db = obtenerDB(context.env);

  if (!db) return responder({ error: 'Base de datos no configurada.' }, 500);

  const datos = await leerCuerpo(context.request);
  const validacion = validar(datos);

  if (validacion.error) return responder({ error: validacion.error }, 400);

  const titulo = validacion.titulo;
  const contenido = validacion.contenido;

  /* Aquí se generan los campos que el usuario NO tiene que escribir. */
  const resumen = derivarResumen(contenido);
  const claves = derivarClaves(titulo, contenido);

  try {
    const grabado = await db.prepare(
      'INSERT INTO articulos (titulo, resumen, contenido, url, claves) ' +
      'VALUES (?, ?, ?, ?, ?)'
    ).bind(titulo, resumen, contenido, '#', claves).run();

    const id = grabado.meta && grabado.meta.last_row_id;

    const entrada = await db.prepare(
      'SELECT id, titulo, resumen, contenido, url, claves ' +
      'FROM articulos WHERE id = ?'
    ).bind(id).first();

    return responder({ ok: true, entrada: entrada }, 201);
  } catch (error) {
    registrarError('Error al crear entrada:', error);
    return responder({ error: 'No se pudo guardar la entrada.' }, 500);
  }
};

/* --------------------------------------------------------------------------
   PATCH — Editar entrada
   -------------------------------------------------------------------------- */
export const onRequestPatch = async (context) => {
  const sinSesion = await exigirSesion(context.request, context.env);
  if (sinSesion) return sinSesion;

  if (!origenValido(context.request)) {
    return responder({ error: 'Origen no permitido.' }, 403);
  }

  const db = obtenerDB(context.env);

  if (!db) return responder({ error: 'Base de datos no configurada.' }, 500);

  const datos = await leerCuerpo(context.request);
  const validacion = validar(datos);

  if (validacion.error) return responder({ error: validacion.error }, 400);

  const id = Number(datos && datos.id);

  if (!Number.isInteger(id) || id < 1) {
    return responder({ error: 'Identificador no válido.' }, 400);
  }

  const titulo = validacion.titulo;
  const contenido = validacion.contenido;

  const resumen = derivarResumen(contenido);
  const claves = derivarClaves(titulo, contenido);

  try {
    const existe = await db.prepare('SELECT id FROM articulos WHERE id = ?')
      .bind(id).first();

    if (!existe) return responder({ error: 'La entrada no existe.' }, 404);

    await db.prepare(
      'UPDATE articulos SET titulo = ?, resumen = ?, ' +
      'contenido = ?, claves = ? WHERE id = ?'
    ).bind(titulo, resumen, contenido, claves, id).run();

    const entrada = await db.prepare(
      'SELECT id, titulo, resumen, contenido, url, claves ' +
      'FROM articulos WHERE id = ?'
    ).bind(id).first();

    return responder({ ok: true, entrada: entrada });
  } catch (error) {
    registrarError('Error al editar entrada:', error);
    return responder({ error: 'No se pudo editar la entrada.' }, 500);
  }
};

/* --------------------------------------------------------------------------
   DELETE — Borrar entrada
   -------------------------------------------------------------------------- */
export const onRequestDelete = async (context) => {
  const sinSesion = await exigirSesion(context.request, context.env);
  if (sinSesion) return sinSesion;

  if (!origenValido(context.request)) {
    return responder({ error: 'Origen no permitido.' }, 403);
  }

  const db = obtenerDB(context.env);

  if (!db) return responder({ error: 'Base de datos no configurada.' }, 500);

  const id = Number(new URL(context.request.url).searchParams.get('id'));

  if (!Number.isInteger(id) || id < 1) {
    return responder({ error: 'Identificador no válido.' }, 400);
  }

  try {
    const existe = await db.prepare('SELECT id FROM articulos WHERE id = ?')
      .bind(id).first();

    if (!existe) return responder({ error: 'La entrada no existe.' }, 404);

    await db.prepare('DELETE FROM articulos WHERE id = ?').bind(id).run();

    return responder({ ok: true, id: id });
  } catch (error) {
    registrarError('Error al borrar entrada:', error);
    return responder({ error: 'No se pudo borrar la entrada.' }, 500);
  }
};
