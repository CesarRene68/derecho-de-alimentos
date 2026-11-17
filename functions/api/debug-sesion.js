/* Diagnóstico temporal. ELIMINAR después de corregir. */
import { verificarContrasena } from '../../lib/autenticacion.js';

export const onRequestGet = async (context) => {
  const h = String(context.env.ADMIN_PASSWORD_HASH || '');
  const partes = h.trim().split('$');
  return Response.json({
    hash: h,
    partes: partes.length,
    prefix: partes[0],
    iter: partes[1],
    sal: partes[2],
    digest: partes[3],
    verifica: await verificarContrasena('Alimentos2026!Panel', h)
  }, { headers: { 'Cache-Control': 'no-store' } });
};
