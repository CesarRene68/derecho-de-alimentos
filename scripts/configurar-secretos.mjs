/* ==========================================================================
   configurar-secretos.mjs — Configura los secretos del panel en producción.
   --------------------------------------------------------------------------
   Uso:
     node scripts/configurar-secretos.mjs
     node scripts/configurar-secretos.mjs nombre-del-proyecto

   Pregunta la contraseña del panel, genera el hash PBKDF2 y la clave de la
   sesión, y los sube a Cloudflare Pages con `wrangler pages secret put`.

   La contraseña se escribe en tu terminal (no se guarda ni se envía a ningún
   archivo). El nombre del proyecto se toma de wrangler.jsonc; si tu proyecto
   en Cloudflare se llama de otra forma, pásalo como argumento.
   ========================================================================== */

import { randomBytes, pbkdf2Sync } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin as entrada, stdout as salida } from 'node:process';
import { spawnSync } from 'node:child_process';

const ITERACIONES = 210000;
const proyecto = String(process.argv[2] || '').trim();

const interfaz = createInterface({ input: entrada, output: salida });

let contrasena;
try {
  contrasena = (await interfaz.question(
    'Contraseña del panel (mínimo 10 caracteres): '
  )).trim();
} finally {
  interfaz.close();
}

if (contrasena.length < 10) {
  console.error('\nLa contraseña debe tener al menos 10 caracteres.');
  process.exit(1);
}

const sal = randomBytes(16);
const hash = pbkdf2Sync(contrasena, sal, ITERACIONES, 32, 'sha256');
const ADMIN_PASSWORD_HASH = 'pbkdf2$' + ITERACIONES + '$' +
  sal.toString('base64url') + '$' + hash.toString('base64url');
const SESSION_SECRET = randomBytes(32).toString('base64url');

/** Sube un secreto a Pages usando Wrangler y el valor recibido por stdin. */
function subirSecreto(nombre, valor) {
  const argumentos = [
    '--yes', 'wrangler@latest', 'pages', 'secret', 'put', nombre
  ];
  if (proyecto) argumentos.push('--project-name', proyecto);

  const resultado = spawnSync('npx', argumentos, {
    input: valor + '\n',
    encoding: 'utf8',
    shell: true,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  const salidaCompleta = ((resultado.stdout || '') + '\n' + (resultado.stderr || '')).trim();
  if (salidaCompleta) console.log(salidaCompleta);

  if (resultado.error || resultado.status !== 0) {
    console.error('\nNo se pudo subir ' + nombre + '.');
    if (resultado.error) console.error(resultado.error.message);
    process.exit(1);
  }
}

console.log('\nSubiendo secretos a Cloudflare Pages…\n');
subirSecreto('ADMIN_PASSWORD_HASH', ADMIN_PASSWORD_HASH);
subirSecreto('SESSION_SECRET', SESSION_SECRET);

console.log('\n✅ Secretos configurados.');
console.log('Ahora vuelve a desplegar el sitio para que se apliquen.');
console.log('Contraseña del panel: la que acabas de escribir.\n');
