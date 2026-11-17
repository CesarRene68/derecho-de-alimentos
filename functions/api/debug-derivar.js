/* Diagnóstico temporal. ELIMINAR en cuanto se identifique el fallo. */
const PASOS = [1, 1000, 10000, 50000, 100000, 210000];

export const onRequestGet = async (context) => {
  const resultados = [];
  const sal = new Uint8Array(16);
  const datos = new TextEncoder().encode('Alimentos2026!Panel');

  try {
    const clave = await crypto.subtle.importKey(
      'raw', datos, 'PBKDF2', false, ['deriveBits']
    );
    resultados.push({ paso: 'importKey', ok: true });

    for (const iteraciones of PASOS) {
      const inicio = Date.now();
      try {
        const bits = await crypto.subtle.deriveBits(
          { name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: iteraciones },
          clave,
          256
        );
        resultados.push({
          paso: 'deriveBits',
          iteraciones,
          ok: true,
          bytes: new Uint8Array(bits).byteLength,
          ms: Date.now() - inicio
        });
      } catch (error) {
        resultados.push({
          paso: 'deriveBits',
          iteraciones,
          ok: false,
          error: String(error && error.message ? error.message : error)
        });
      }
    }
  } catch (error) {
    resultados.push({
      paso: 'importKey',
      ok: false,
      error: String(error && error.message ? error.message : error)
    });
  }

  let decodificacion = null;
  try {
    const hash = String(context.env.ADMIN_PASSWORD_HASH || '');
    const partes = hash.trim().split('$');
    const aBytes = (texto) => {
      const n = String(texto).replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
      const c = n + '='.repeat((4 - n.length % 4) % 4);
      const b = atob(c);
      return Uint8Array.from(b, (x) => x.charCodeAt(0));
    };
    decodificacion = {
      partes: partes.length,
      longitud: hash.length,
      salBytes: aBytes(partes[2]).byteLength,
      digestBytes: aBytes(partes[3]).byteLength
    };
  } catch (error) {
    decodificacion = { error: String(error && error.message ? error.message : error) };
  }

  return Response.json(
    {
      resultados,
      decodificacion,
      timingSafeEqual: typeof crypto.subtle.timingSafeEqual
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
};
