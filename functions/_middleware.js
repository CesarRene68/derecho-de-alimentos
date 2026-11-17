/* ==========================================================================
   functions/_middleware.js — Protección del HTML del panel.
   --------------------------------------------------------------------------
   El middleware de raíz se ejecuta también delante de archivos estáticos,
   así que puede impedir que se sirva /admin/index.html sin sesión.

   El API (/api/admin/*) se protege por separado dentro de sus handlers:
   la ruta de login debe seguir siendo pública.
   ========================================================================== */

'use strict';

import { esSesionValida } from '../lib/autenticacion.js';

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const esPanel = url.pathname === '/admin' || url.pathname.startsWith('/admin/');

  if (esPanel && !(await esSesionValida(context.request, context.env))) {
    const destino = url.pathname + url.search;
    const ingreso = new URL('/ingresar.html', url.origin);
    ingreso.searchParams.set('next', destino);

    return Response.redirect(ingreso.toString(), 302);
  }

  return context.next();
}
