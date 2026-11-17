/* ==========================================================================
   functions/articulo.js — Página de lectura /articulo?id=123
   --------------------------------------------------------------------------
   Renderiza el artículo completo en el servidor (HTML listo, sin depender de
   JavaScript) con tipografía grande y sin distracciones. El contenido se
   sanitiza con renderizarContenido() y todo lo demás se escapa.
   ========================================================================== */

'use strict';

import {
  escaparHTML,
  renderizarContenido
} from '../lib/contenido.js';

/* Repetimos el script de tema de index.html para evitar el destello blanco. */
const SCRIPT_TEMA =
  '<script>(function(){try{' +
  'if(localStorage.getItem("tema")==="dark"){' +
  'document.documentElement.setAttribute("data-theme","dark");' +
  'var m=document.querySelector(\'meta[name="theme-color"]\');' +
  'if(m)m.setAttribute("content","#202124");' +
  '}}catch(e){}})();<\/script>';

const BOTON_TEMA =
  '<button class="boton-tema" id="boton-tema" type="button" ' +
  'aria-label="Activar tema oscuro" title="Cambiar a tema oscuro">' +
    '<svg class="icono-luna" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/>' +
    '</svg>' +
    '<svg class="icono-sol" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      '<circle cx="12" cy="12" r="4"/>' +
      '<path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>' +
    '</svg>' +
  '</button>';

function formatearFecha(valor) {
  if (!valor) return '';

  try {
    return new Intl.DateTimeFormat('es-MX', {
      year: 'numeric', month: 'long', day: 'numeric'
    }).format(new Date(valor));
  } catch (error) {
    return '';
  }
}

/** Devuelve el HTML completo de la página de lectura. */
function construirPagina(opciones) {
  const titulo = escaparHTML(opciones.titulo);
  const descripcion = escaparHTML(opciones.descripcion || '');
  const fecha = escaparHTML(opciones.fecha || '');
  const volver = escaparHTML(opciones.volver);
  const contenido = opciones.contenido;

  return '<!DOCTYPE html>\n' +
    '<html lang="es" data-theme="light">\n' +
    '<head>\n' +
      '<meta charset="UTF-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
      '<meta name="theme-color" content="#ffffff">\n' +
      '<meta name="description" content="' + descripcion + '">\n' +
      '<title>' + titulo + ' | Derecho de Alimentos</title>\n' +
      '<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">\n' +
      SCRIPT_TEMA + '\n' +
      '<link rel="stylesheet" href="/css/estilos.css">\n' +
      '<link rel="stylesheet" href="/css/articulo.css">\n' +
    '</head>\n' +
    '<body class="articulo-body">\n' +
      '<a class="salto-contenido" href="#articulo-contenido">Saltar al contenido</a>\n' +
      '<header class="cabecera">\n' +
        '<div class="contenedor cabecera__interior">\n' +
          '<h1 class="marca">' +
            '<a href="/index.html" aria-label="Derecho de Alimentos, ir al inicio">' +
              'DERECHO DE ALIMENTOS</a>' +
          '</h1>\n' +
          BOTON_TEMA + '\n' +
        '</div>\n' +
      '</header>\n' +
      '<main class="lector">\n' +
        '<nav class="lector__barra" aria-label="Navegación del artículo">\n' +
          '<a class="lector__volver" href="' + volver + '">← Volver a resultados</a>\n' +
        '</nav>\n' +
        '<article class="lector__articulo" aria-labelledby="articulo-titulo">\n' +
          '<h2 class="lector__titulo" id="articulo-titulo">' + titulo + '</h2>\n' +
          (fecha ? '<p class="lector__fecha">' + fecha + '</p>\n' : '') +
          '<div class="lector__contenido" id="articulo-contenido">' + contenido + '</div>\n' +
        '</article>\n' +
        '<footer class="lector__pie">\n' +
          '<p>La información de este sitio es general e informativa y no ' +
            'sustituye la asesoría jurídica de un abogado para un caso concreto.</p>\n' +
          '<a href="/index.html">Ir al buscador →</a>\n' +
        '</footer>\n' +
      '</main>\n' +
      '<script src="/js/tema.js"><\/script>\n' +
    '</body>\n' +
    '</html>';
}

function responderHTML(html, estado) {
  return new Response(html, {
    status: estado || 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

export const onRequestGet = async (context) => {
  const url = new URL(context.request.url);
  const id = Number(url.searchParams.get('id'));
  const consulta = String(url.searchParams.get('q') || '').trim();

  const volver = new URL('/index.html', url.origin);
  if (consulta) volver.searchParams.set('q', consulta);

  if (!context.env || !context.env.DB) {
    return responderHTML(construirPagina({
      titulo: 'Contenido no disponible',
      descripcion: 'La base de datos no está configurada.',
      volver: volver.toString(),
      contenido: '<p>La base de datos no está configurada. Inténtalo más tarde.</p>'
    }), 503);
  }

  if (!Number.isInteger(id) || id < 1) {
    return responderHTML(construirPagina({
      titulo: 'Artículo no encontrado',
      descripcion: 'No se encontró el artículo solicitado.',
      volver: volver.toString(),
      contenido: '<p>El enlace no es válido. Vuelve al buscador para encontrar el contenido.</p>'
    }), 404);
  }

  try {
    const articulo = await context.env.DB.prepare(
      'SELECT id, titulo, resumen, contenido, created_at ' +
      'FROM articulos WHERE id = ?'
    ).bind(id).first();

    if (!articulo) {
      return responderHTML(construirPagina({
        titulo: 'Artículo no encontrado',
        descripcion: 'No se encontró el artículo solicitado.',
          volver: volver.toString(),
        contenido: '<p>Ese artículo ya no está disponible. Vuelve al buscador.</p>'
      }), 404);
    }

    return responderHTML(construirPagina({
      titulo: articulo.titulo,
      descripcion: articulo.resumen,
      fecha: formatearFecha(articulo.created_at),
      volver: volver.toString(),
      contenido: renderizarContenido(articulo.contenido)
    }));
  } catch (error) {
    console.error('Error al leer el artículo:',
      error && error.message ? error.message : error);

    return responderHTML(construirPagina({
      titulo: 'No se pudo cargar el artículo',
      descripcion: 'Error temporal al leer el contenido.',
      volver: volver.toString(),
      contenido: '<p>No se pudo cargar el contenido. Inténtalo de nuevo en unos segundos.</p>'
    }), 500);
  }
};
