// Arma la carpeta dist/ que se publica en Vercel.
//
// Por seguridad NO se publica todo el repositorio: solo las páginas, estilos,
// scripts de la app e imágenes. Así supabase/ (SQL), tests/, docs/, scripts/,
// package.json y README.md nunca quedan accesibles desde Internet.
// También crea js/config.js con las variables de entorno y revisa que no se
// haya colado una clave secreta.
//
// Uso:  SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/construir.js
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearContenidoConfig } from './generar-config.js';

// Lista blanca: lo único que se publica.
export const PUBLICAR = ['index.html', 'admin.html', 'css', 'img', 'js'];
// Dentro de js/ estos archivos no se copian (config.js se crea aparte).
const EXCLUIR_EN_JS = new Set(['config.js', 'config.example.js']);
const EXTENSIONES_TEXTO = /\.(html|css|js|svg|json|txt|map)$/i;

function listar(carpeta) {
  return readdirSync(carpeta, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listar(join(carpeta, e.name)) : [join(carpeta, e.name)]);
}

// Busca claves secretas escritas en los archivos que se van a publicar.
export function buscarSecretos(carpeta) {
  const hallazgos = [];
  for (const archivo of listar(carpeta)) {
    if (!EXTENSIONES_TEXTO.test(archivo)) continue;
    const texto = readFileSync(archivo, 'utf8');
    if (/sb_secret_[A-Za-z0-9_-]{10,}/.test(texto)) hallazgos.push(`${archivo}: clave sb_secret_`);
    for (const jwt of texto.match(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g) || []) {
      try {
        const carga = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
        if (carga.role === 'service_role') hallazgos.push(`${archivo}: JWT con rol service_role`);
      } catch { /* no era un JWT */ }
    }
  }
  return hallazgos;
}

export function construir({ raiz, destino, env }) {
  const contenidoConfig = crearContenidoConfig(env); // falla antes de tocar nada si faltan variables
  rmSync(destino, { recursive: true, force: true });
  mkdirSync(destino, { recursive: true });

  for (const nombre of PUBLICAR) {
    const origen = join(raiz, nombre);
    if (!existsSync(origen)) throw new Error(`Falta ${nombre} en el proyecto`);
    cpSync(origen, join(destino, nombre), {
      recursive: true,
      filter: (ruta) => !(ruta.startsWith(join(raiz, 'js') + '/') && EXCLUIR_EN_JS.has(ruta.split('/').pop())),
    });
  }
  writeFileSync(join(destino, 'js', 'config.js'), contenidoConfig);

  const secretos = buscarSecretos(destino);
  if (secretos.length) {
    rmSync(destino, { recursive: true, force: true });
    throw new Error(`Se encontró una clave secreta en lo que se iba a publicar:\n- ${secretos.join('\n- ')}`);
  }
  return listar(destino).map((a) => a.slice(destino.length + 1)).sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const raiz = fileURLToPath(new URL('..', import.meta.url));
    const archivos = construir({ raiz, destino: join(raiz, 'dist'), env: process.env });
    console.log(`dist/ listo con ${archivos.length} archivos:\n- ${archivos.join('\n- ')}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}
