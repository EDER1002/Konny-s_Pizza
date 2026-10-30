// Crea js/config.js a partir de las variables de entorno.
// Vercel lo ejecuta en cada despliegue (ver vercel.json), así las claves
// nunca quedan escritas en el repositorio.
//
// Uso local:  SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/generar-config.js
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Revisa si la clave es secreta (no se debe usar nunca en el navegador).
function esClaveSecreta(clave) {
  if (clave.startsWith('sb_secret_')) return true;
  const partes = clave.split('.');
  if (partes.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8'));
    return payload.role === 'service_role';
  } catch {
    return false;
  }
}

export function crearContenidoConfig(env) {
  const url = (env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const clave = (env.SUPABASE_ANON_KEY || '').trim();

  if (!url) throw new Error('Falta la variable SUPABASE_URL');
  if (!clave) throw new Error('Falta la variable SUPABASE_ANON_KEY');
  if (esClaveSecreta(clave)) {
    throw new Error('SUPABASE_ANON_KEY es una clave secreta (service_role). Usa la clave pública anon/publishable.');
  }

  return [
    '// Archivo generado por scripts/generar-config.js. No lo subas a GitHub.',
    `export const SUPABASE_URL = ${JSON.stringify(url)};`,
    `export const SUPABASE_ANON_KEY = ${JSON.stringify(clave)};`,
    '',
  ].join('\n');
}

// Solo escribe el archivo cuando se ejecuta como script (no en las pruebas).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const destino = new URL('../js/config.js', import.meta.url);
    writeFileSync(destino, crearContenidoConfig(process.env));
    console.log('js/config.js creado correctamente.');
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}
