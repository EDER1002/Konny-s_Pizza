// Pruebas de la publicación segura: solo se publica una lista blanca de archivos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { construir, buscarSecretos } from '../scripts/construir.js';

const ENV = { SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_ANON_KEY: 'sb_publishable_clavepublica123' };

function proyectoFalso() {
  const raiz = mkdtempSync(join(tmpdir(), 'konys-'));
  for (const d of ['css', 'img', 'js', 'supabase', 'tests', 'docs', 'scripts']) mkdirSync(join(raiz, d));
  const archivos = {
    'index.html': '<h1>hola</h1>', 'admin.html': '<h1>admin</h1>', 'css/styles.css': 'a{}', 'img/logo.svg': '<svg/>',
    'js/cliente.js': '// app', 'js/config.example.js': '// ejemplo', 'js/config.js': 'export const SUPABASE_ANON_KEY = "local";',
    'supabase/schema.sql': 'create table x();', 'tests/a.test.js': '', 'docs/GUIA.md': '# guia',
    'scripts/construir.js': '', 'README.md': '# leeme', 'package.json': '{}', '.env': 'SUPABASE_SECRET=1',
  };
  for (const [ruta, texto] of Object.entries(archivos)) writeFileSync(join(raiz, ruta), texto);
  return raiz;
}

test('solo publica la lista blanca y crea config.js con las variables de entorno', () => {
  const raiz = proyectoFalso();
  const lista = construir({ raiz, destino: join(raiz, 'dist'), env: ENV });
  assert.deepEqual(lista, ['admin.html', 'css/styles.css', 'img/logo.svg', 'index.html', 'js/cliente.js', 'js/config.js']);
  assert.match(readFileSync(join(raiz, 'dist/js/config.js'), 'utf8'), /https:\/\/abc\.supabase\.co/);
});

test('nunca publica SQL, pruebas, documentos, README ni archivos .env', () => {
  const raiz = proyectoFalso();
  construir({ raiz, destino: join(raiz, 'dist'), env: ENV });
  for (const ruta of ['supabase', 'tests', 'docs', 'scripts', 'README.md', 'package.json', '.env', 'js/config.example.js']) {
    assert.equal(existsSync(join(raiz, 'dist', ruta)), false, `${ruta} no debe publicarse`);
  }
});

test('el config.js local no se cuela: se reemplaza por el de las variables de entorno', () => {
  const raiz = proyectoFalso();
  construir({ raiz, destino: join(raiz, 'dist'), env: ENV });
  assert.doesNotMatch(readFileSync(join(raiz, 'dist/js/config.js'), 'utf8'), /"local"/);
});

test('falla si faltan las variables y no deja dist a medias', () => {
  const raiz = proyectoFalso();
  assert.throws(() => construir({ raiz, destino: join(raiz, 'dist'), env: {} }), /Falta la variable/);
  assert.equal(existsSync(join(raiz, 'dist')), false);
});

test('detecta y borra el resultado si hay una clave secreta en los archivos', () => {
  const raiz = proyectoFalso();
  writeFileSync(join(raiz, 'js/cliente.js'), 'const k = "sb_secret_abcdefghijklmnop12345";');
  assert.throws(() => construir({ raiz, destino: join(raiz, 'dist'), env: ENV }), /clave secreta/);
  assert.equal(existsSync(join(raiz, 'dist')), false);
});

test('buscarSecretos reconoce un JWT con rol service_role', () => {
  const raiz = proyectoFalso();
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = `${b64({ alg: 'HS256' })}.${b64({ role: 'service_role' })}.firmafirmafirma`;
  writeFileSync(join(raiz, 'js/cliente.js'), `const k = "${jwt}";`);
  assert.equal(buscarSecretos(join(raiz, 'js')).length, 1);
  const anon = `${b64({ alg: 'HS256' })}.${b64({ role: 'anon' })}.firmafirmafirma`;
  writeFileSync(join(raiz, 'js/cliente.js'), `const k = "${anon}";`);
  assert.equal(buscarSecretos(join(raiz, 'js')).length, 0);
});
