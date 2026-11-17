/* Diagnóstico temporal. ELIMINAR después de corregir. */
import { verificarContrasena } from '../../lib/autenticacion.js';

export const onRequestGet = async (context) => {
  const h = String(context.env.ADMIN_PASSWORD_HASH || '');
  const partes = h.trim().split('$');
  const clave = 'Alimentos2026!Panel';
  const calculado = Array.from(new Uint8Array(
    await (async () => {
      const salBytes = Uint8Array.from(atob(partes[2].replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - partes[2].length % 4) % 4)), (c) => c.charCodeAt(0));
      const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(clave), 'PBKDF2', false, ['deriveBits']);
      return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salBytes, iterations: 210000 }, k, 256);
    })()
  ));
  return Response.json({
    hash: h,
    partes: partes.length,
    prefix: partes[0],
    iter: partes[1],
    sal: partes[2],
    digest: partes[3],
    verifica: await verificarContrasena(clave, h),
    calculado: calculado.length,
    calculadoMuestra: calculado.slice(0, 8),
    esperadoMuestra: Array.from(new Uint8Array(
      Uint8Array.from(atob(partes[3].replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - partes[3].length % 4) % 4)), (c) => c.charCodeAt(0))
    )).slice(0, 8),
    cryptoNombre: typeof crypto.subtle.timingSafeEqual
  }, { headers: { 'Cache-Control': 'no-store' } });
};
