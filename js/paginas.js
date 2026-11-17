/* ==========================================================================
   paginas.js — Índice manual de páginas que se agregarán al sitio.
   --------------------------------------------------------------------------
   El buscador crea su índice automáticamente con las secciones visibles para
   SEO que están en index.html. Cuando existan páginas independientes
   (Monto, Demandas, Formatos, Legislación, Tratados, etc.), agrega aquí una
   ficha por página.

   Estructura de cada ficha:
   {
     titulo:    'Monto de la pensión alimenticia',
     categoria: 'Monto',
     url:       'paginas/monto.html',
     claves:    ['monto', 'pensión', 'UMA', 'salario mínimo'],
     parrafos:  ['Primer párrafo...', 'Segundo párrafo...']
   }

   También puedes usar la propiedad "texto" en lugar de "parrafos"; el
   buscador la dividirá en párrafos por líneas en blanco.
   ========================================================================== */

'use strict';

/* Arreglo global que lee js/busqueda.js. Se deja vacío hasta crear páginas. */
window.PAGINAS_DEL_SITIO = [];
