/* Diagnóstico temporal. ELIMINAR después de corregir. */
export const onRequestGet = async (context) => {
  const h = String(context.env.ADMIN_PASSWORD_HASH || '');
  const s = String(context.env.SESSION_SECRET || '');
  const partes = h.trim().split('$');
  return Response.json({
    hashLength: h.length,
    hashParts: partes.length,
    prefix: partes[0],
    iteraciones: partes[1],
    salLength: partes[2] ? partes[2].length : 0,
    hashLengthPart: partes[3] ? partes[3].length : 0,
    secretLength: s.length,
    hashPrime: h.slice(0, 40)
  }, { headers: { 'Cache-Control': 'no-store' } });
};
