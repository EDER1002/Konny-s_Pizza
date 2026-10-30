// Pruebas del script que crea js/config.js con las variables de entorno.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearContenidoConfig } from '../scripts/generar-config.js';

test('crea el módulo con la URL y la clave de Supabase', () => {
  const contenido = crearContenidoConfig({
    SUPABASE_URL: 'https://abc.supabase.co',
    SUPABASE_ANON_KEY: 'clave-publica',
  });
  assert.match(contenido, /export const SUPABASE_URL = "https:\/\/abc\.supabase\.co";/);
  assert.match(contenido, /export const SUPABASE_ANON_KEY = "clave-publica";/);
});

test('quita espacios sobrantes de las variables', () => {
  const contenido = crearContenidoConfig({
    SUPABASE_URL: '  https://abc.supabase.co/ \n',
    SUPABASE_ANON_KEY: ' clave ',
  });
  assert.match(contenido, /SUPABASE_URL = "https:\/\/abc\.supabase\.co";/);
  assert.match(contenido, /SUPABASE_ANON_KEY = "clave";/);
});

test('falla con un mensaje claro si falta una variable', () => {
  assert.throws(
    () => crearContenidoConfig({ SUPABASE_URL: 'https://abc.supabase.co' }),
    /Falta la variable SUPABASE_ANON_KEY/
  );
  assert.throws(
    () => crearContenidoConfig({ SUPABASE_ANON_KEY: 'x' }),
    /Falta la variable SUPABASE_URL/
  );
});

test('rechaza una clave secreta (service_role) por seguridad', () => {
  // Una clave service_role es un JWT cuyo payload dice role "service_role".
  const payload = Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url');
  const claveSecreta = `xxx.${payload}.yyy`;
  assert.throws(
    () => crearContenidoConfig({ SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_ANON_KEY: claveSecreta }),
    /clave secreta/
  );
  assert.throws(
    () => crearContenidoConfig({ SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_ANON_KEY: 'sb_secret_123' }),
    /clave secreta/
  );
});
