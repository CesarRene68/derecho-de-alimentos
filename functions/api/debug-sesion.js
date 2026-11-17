/* Diagnóstico temporal. ELIMINAR después de corregir. */
import { verificarContrasena } from '../../lib/autenticacion.js';

export const onRequestGet = async (context) => {
  const h = String(context.env.ADMIN_PASSWORD_HASH || '');
  const resultados = [];
  for (const clave of ['Alimentos2026!Panel', 'clave-dev-segura-123']) {
    resultados.push({ clave, ok: await verificarContrasena(clave, h) });
  }
  return Response.json({ resultados }, { headers: { 'Cache-Control': 'no-store' } });
};
