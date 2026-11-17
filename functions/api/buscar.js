/* ==========================================================================
   functions/api/buscar.js — Endpoint de búsqueda (Cloudflare Pages Function).
   --------------------------------------------------------------------------
   Ruta pública: GET /api/buscar?q=pension&limite=20

   ¿Qué hace?
     1. Normaliza la consulta (minúsculas, sin acentos, sin palabras vacías).
     2. Convierte cada palabra en un término FTS5 con prefijo (palabra*).
     3. Consulta la tabla FTS5 de D1 ordenando por relevancia (bm25).
     4. Devuelve un JSON con los resultados.

   🔧 CONEXIÓN A LA BASE DE DATOS:
      Se usa "context.env.DB", que es el binding "DB" definido en
      wrangler.jsonc. Ahí es donde está conectada la base de datos D1.

   La búsqueda usa prepared statements (.prepare().bind()), por lo que el
   texto del visitante NUNCA se concatena directamente en el SQL.
   ========================================================================== */

'use strict';

/* Utilidades compartidas con el panel admin. "contenido_html" viene ya
   escapado y con las URLs sueltas convertidas en enlaces seguros. */
import { renderizarContenido } from '../../lib/contenido.js';

/* --------------------------------------------------------------------------
   1. CONFIGURACIÓN
   -------------------------------------------------------------------------- */

/* Palabras que no aportan a la búsqueda. Se escriben sin acentos porque la
   consulta se normaliza antes de comparar. */
const PALABRAS_VACIAS = new Set([
  'a', 'al', 'ante', 'bajo', 'como', 'con', 'contra', 'de', 'del',
  'desde', 'donde', 'durante', 'el', 'en', 'entre', 'es', 'esta',
  'este', 'estos', 'estas', 'hacia', 'hasta', 'la', 'las', 'le',
  'les', 'lo', 'los', 'mas', 'me', 'mediante', 'mi', 'mis', 'mucho',
  'muy', 'nuestro', 'nuestra', 'o', 'para', 'pero', 'por', 'que',
  'se', 'segun', 'sin', 'sobre', 'son', 'su', 'sus', 'te', 'tras',
  'tu', 'tus', 'u', 'un', 'una', 'unas', 'uno', 'unos', 'y'
]);

/* Límites de la petición. El servidor siempre vuelve a validarlos aunque el
   navegador ya los haya validado. */
const MIN_CARACTERES = 2;
const LIMITE_POR_DEFECTO = 20;
const LIMITE_MAXIMO = 50;


/* --------------------------------------------------------------------------
   2. UTILIDADES DE TEXTO
   -------------------------------------------------------------------------- */

/**
 * Pasa un texto a minúsculas, elimina acentos y se queda solo con letras,
 * números y espacios. Es la misma normalización que hace el navegador,
 * para que cliente y servidor "hablen el mismo idioma".
 */
function normalizar(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Devuelve las palabras significativas de la consulta.
 * Descarta palabras vacías y letras sueltas.
 */
function tokenizar(texto) {
  return normalizar(texto)
    .split(' ')
    .filter(function (palabra) {
      return palabra.length > 1 && !PALABRAS_VACIAS.has(palabra);
    });
}

/**
 * Construye el término que entiende FTS5.
 *
 * Ejemplos:
 *   "pension"        → "pension*"
 *   "monto uma"      → "monto* AND uma*"
 *
 * El asterisco permite coincidencias por prefijo: "pension*" encuentra
 * "pensión", "pensiones", etc. Como los tokens solo contienen [a-z0-9],
 * no hay comillas ni caracteres especiales que escapar.
 */
function construirTerminoFTS(tokens) {
  return tokens
    .map(function (token) { return token + '*'; })
    .join(' AND ');
}

/**
 * Convierte el valor del parámetro "limite" en un número seguro.
 * Nunca se confía en lo que envía el visitante.
 */
function leerLimite(valor) {
  const numero = parseInt(String(valor || ''), 10);

  if (!Number.isFinite(numero) || numero < 1) return LIMITE_POR_DEFECTO;
  return Math.min(numero, LIMITE_MAXIMO);
}


/* --------------------------------------------------------------------------
   3. CONSULTA A D1
   -------------------------------------------------------------------------- */

/**
 * Ejecuta la búsqueda de texto completo en la base de datos.
 * "db" es context.env.DB (el binding de wrangler.jsonc).
 */
async function consultar(db, termino, limite) {
  const sentencia = db.prepare(
    'SELECT a.id, a.titulo, a.categoria, a.resumen, a.contenido, a.url, a.claves, ' +
    '       bm25(articulos_fts) AS relevancia ' +
    'FROM articulos_fts ' +
    'INNER JOIN articulos AS a ON a.id = articulos_fts.rowid ' +
    'WHERE articulos_fts MATCH ? ' +
    'ORDER BY relevancia ASC ' +
    'LIMIT ?'
  );

  /* Los valores van en .bind() en el mismo orden que los "?". */
  const respuesta = await sentencia.bind(termino, limite).all();
  return respuesta.results || [];
}


/* --------------------------------------------------------------------------
   4. MANEJADOR DE LA RUTA
   -------------------------------------------------------------------------- */

/**
 * Pages Functions llama a esta función para peticiones GET /api/buscar.
 * "context" trae request (la petición) y env (los bindings, incluida la BD).
 */
export const onRequestGet = async (context) => {
  const request = context.request;
  const env = context.env;

  /* Respuesta auxiliar para mantener un formato de error consistente. */
  const responderError = (mensaje, codigo) => {
    return Response.json(
      { consulta: '', total: 0, resultados: [], error: mensaje },
      { status: codigo, headers: { 'Cache-Control': 'no-store' } }
    );
  };

  /* 🔧 Si el binding no existe, casi siempre falta el database_id en
     wrangler.jsonc o no se inició sesión con wrangler. */
  if (!env || !env.DB) {
    return responderError(
      'La base de datos no está configurada. Revisa el binding DB en wrangler.jsonc.',
      500
    );
  }

  const url = new URL(request.url);
  const consulta = String(url.searchParams.get('q') || '').trim();
  const limite = leerLimite(url.searchParams.get('limite'));

  /* Consulta demasiado corta: no se gasta una lectura de BD. */
  if (consulta.length < MIN_CARACTERES) {
    return Response.json(
      {
        consulta: consulta,
        total: 0,
        resultados: [],
        mensaje: 'Escribe al menos ' + MIN_CARACTERES + ' caracteres.'
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const tokens = tokenizar(consulta);

  /* Consulta formada solo por palabras vacías ("de la y", por ejemplo). */
  if (tokens.length === 0) {
    return Response.json(
      {
        consulta: consulta,
        total: 0,
        resultados: [],
        mensaje: 'Prueba con otras palabras clave.'
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const termino = construirTerminoFTS(tokens);

  try {
    const filas = await consultar(env.DB, termino, limite);

    /* Se devuelve solo lo que la interfaz necesita.
       "contenido" va como texto plano y "contenido_html" ya sanitizado;
       así el navegador no tiene que volver a procesar los enlaces. */
    const resultados = filas.map(function (fila) {
      return {
        id: fila.id,
        titulo: fila.titulo,
        categoria: fila.categoria,
        resumen: fila.resumen,
        contenido: fila.contenido,
        contenido_html: renderizarContenido(fila.contenido),
        url: fila.url,
        claves: fila.claves
      };
    });

    return Response.json(
      {
        consulta: consulta,
        total: resultados.length,
        resultados: resultados
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    /* Se registra el detalle en los logs y al visitante se le da un mensaje
       claro, sin exponer información interna de la base de datos. */
    /* D1 guarda el detalle en error.message (y a veces en error.cause.message).
       Loguear solo el objeto deja el mensaje vacío en los tail de Pages. */
    console.error('Error al buscar en D1:',
      error && error.message ? error.message : error);
    if (error && error.cause && error.cause.message) {
      console.error('Causa:', error.cause.message);
    }

    return responderError(
      'No se pudo consultar la base de datos. Inténtalo de nuevo en unos segundos.',
      500
    );
  }
};
