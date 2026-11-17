/* ==========================================================================
   crear-hash.mjs — Genera los valores para los secretos del panel.
   --------------------------------------------------------------------------
   Uso:  node scripts/crear-hash.mjs

   Pregunta la contraseña por pantalla (no la recibe como argumento, para que
   no quede en el historial de la terminal) e imprime:

     ADMIN_PASSWORD_HASH=...   → PBKDF2-SHA256 con sal aleatoria
     SESSION_SECRET=...        → clave aleatoria para firmar la cookie

   Pega la primera en `npx wrangler pages secret put ADMIN_PASSWORD_HASH` y
   la segunda en `npx wrangler pages secret put SESSION_SECRET`. Para local,
   pon ambas en .dev.vars (copia .dev.vars.example).
   ========================================================================== */

import { randomBytes, pbkdf2Sync } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin as entrada, stdout as salida } from 'node:process';

const ITERACIONES = 100000;

const interfaz = createInterface({ input: entrada, output: salida });

try {
  const contrasena = (await interfaz.question(
    'Contraseña del panel (mínimo 10 caracteres): '
  )).trim();

  if (contrasena.length < 10) {
    console.error('\nLa contraseña debe tener al menos 10 caracteres.');
    process.exitCode = 1;
  } else {
    const sal = randomBytes(16);
    const hash = pbkdf2Sync(contrasena, sal, ITERACIONES, 32, 'sha256');
    const secreto = randomBytes(32);

    console.log('\n--- Secretos generados (no los compartas) ---');
    console.log(
      'ADMIN_PASSWORD_HASH=pbkdf2$' + ITERACIONES + '$' +
      sal.toString('base64url') + '$' + hash.toString('base64url')
    );
    console.log('SESSION_SECRET=' + secreto.toString('base64url'));
    console.log('--------------------------------------------\n');
    console.log('La contraseña en texto plano no se guarda en ningún archivo.');
  }
} finally {
  interfaz.close();
}
