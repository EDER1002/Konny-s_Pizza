import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  crearControlInactividad,
  EVENTOS_ACTIVIDAD_ADMIN,
  TIEMPO_INACTIVIDAD_ADMIN_MS,
} from '../js/inactividad.js';

const raiz = new URL('..', import.meta.url).pathname;
const leer = (ruta) => readFileSync(join(raiz, ruta), 'utf8');

function crearRelojFalso() {
  let instante = 0;
  let secuencia = 0;
  const pendientes = new Map();
  return {
    ahora: () => instante,
    programar(fn, demora) {
      const id = ++secuencia;
      pendientes.set(id, { fn, limite: instante + demora });
      return id;
    },
    cancelar(id) { pendientes.delete(id); },
    avanzar(ms) {
      const destino = instante + ms;
      while (true) {
        const siguiente = [...pendientes.entries()]
          .filter(([, timer]) => timer.limite <= destino)
          .sort((a, b) => a[1].limite - b[1].limite)[0];
        if (!siguiente) break;
        const [id, timer] = siguiente;
        pendientes.delete(id);
        instante = timer.limite;
        timer.fn();
      }
      instante = destino;
    },
    cantidad: () => pendientes.size,
  };
}

function crearEntorno() {
  const destino = new EventTarget();
  const ventana = new EventTarget();
  ventana.document = { visibilityState: 'visible' };
  return { destino, ventana };
}

const esperarMicrotarea = () => new Promise((resolve) => queueMicrotask(resolve));

test('Supabase mantiene la sesión solo en memoria y no persiste tokens en el navegador', () => {
  const codigo = leer('js/supabase.js');
  assert.match(codigo, /persistSession:\s*false/);
  assert.match(codigo, /autoRefreshToken:\s*true/);
  assert.match(codigo, /detectSessionInUrl:\s*false/);
  assert.doesNotMatch(codigo, /\b(?:localStorage|sessionStorage)\b|document\.cookie/i);
  for (const ruta of ['index.html', 'admin.html', 'js/cliente.js', 'js/admin.js', 'js/supabase.js', 'js/inactividad.js']) {
    assert.doesNotMatch(leer(ruta), /\b(?:localStorage|sessionStorage)\b|document\.cookie/i, ruta);
  }
});

test('cerrar sesión elimina el heartbeat y solicita signOut solo para la sesión actual', () => {
  const codigo = leer('js/supabase.js');
  assert.match(codigo, /supabase\.rpc\('cerrar_sesion_admin'\)/);
  assert.match(codigo, /supabase\.auth\.signOut\(\{ scope: 'local' \}\)/);
  assert.match(codigo, /await registrarActividadAdmin\(\)/);
  assert.match(codigo, /new Error\('SESION_ADMIN_EXPIRADA'/);
});

test('el panel administra una sesión basada en inactividad y no en el fragmento URL', () => {
  const admin = leer('js/admin.js');
  const inactividad = leer('js/inactividad.js');
  assert.match(admin, /crearControlInactividad/);
  assert.match(admin, /finalizarSesionAdministrativa\(\{ porInactividad: true \}\)/);
  assert.match(admin, /registrarActividadAdmin/);
  for (const evento of EVENTOS_ACTIVIDAD_ADMIN) assert.ok(inactividad.includes(`'${evento}'`));
  assert.match(admin, /VISTAS\.includes\(inicial\)/); // hash solo selecciona una vista permitida
});

test('cinco minutos sin eventos cierran el control exactamente al vencer el plazo', async () => {
  const reloj = crearRelojFalso();
  const { destino, ventana } = crearEntorno();
  let expiraciones = 0;
  const control = crearControlInactividad({
    destino, ventana,
    ahora: reloj.ahora,
    programar: reloj.programar,
    cancelar: reloj.cancelar,
    alExpirar: () => { expiraciones += 1; },
  });
  control.iniciar();
  assert.equal(control.activo, true);
  reloj.avanzar(TIEMPO_INACTIVIDAD_ADMIN_MS - 1);
  await esperarMicrotarea();
  assert.equal(expiraciones, 0);
  reloj.avanzar(1);
  await esperarMicrotarea();
  assert.equal(expiraciones, 1);
  assert.equal(control.activo, false);
  assert.equal(reloj.cantidad(), 0);
});

test('mouse, teclado, clic, scroll y touch reinician el contador de inactividad', async () => {
  for (const evento of EVENTOS_ACTIVIDAD_ADMIN) {
    const reloj = crearRelojFalso();
    const { destino, ventana } = crearEntorno();
    let expiraciones = 0;
    let actividades = 0;
    const control = crearControlInactividad({
      destino, ventana,
      ahora: reloj.ahora,
      programar: reloj.programar,
      cancelar: reloj.cancelar,
      alExpirar: () => { expiraciones += 1; },
      alRegistrarActividad: () => { actividades += 1; },
    });
    control.iniciar();
    reloj.avanzar(TIEMPO_INACTIVIDAD_ADMIN_MS - 1000);
    destino.dispatchEvent(new Event(evento));
    reloj.avanzar(TIEMPO_INACTIVIDAD_ADMIN_MS - 1000);
    await esperarMicrotarea();
    assert.equal(expiraciones, 0, `${evento} debe reiniciar el contador`);
    assert.equal(actividades, 1, `${evento} debe registrar actividad válida`);
    reloj.avanzar(1000);
    await esperarMicrotarea();
    assert.equal(expiraciones, 1, `${evento} debe expirar cinco minutos después de la nueva actividad`);
  }
});

test('una interacción que llega después del límite no revive la sesión', async () => {
  const reloj = crearRelojFalso();
  const { destino, ventana } = crearEntorno();
  let expiraciones = 0;
  let actividades = 0;
  const control = crearControlInactividad({
    destino, ventana,
    ahora: reloj.ahora,
    programar: reloj.programar,
    cancelar: reloj.cancelar,
    alExpirar: () => { expiraciones += 1; },
    alRegistrarActividad: () => { actividades += 1; },
  });
  control.iniciar();
  reloj.avanzar(TIEMPO_INACTIVIDAD_ADMIN_MS);
  destino.dispatchEvent(new Event('click'));
  await esperarMicrotarea();
  assert.equal(expiraciones, 1);
  assert.equal(actividades, 0);
});

test('pagehide suspende listeners/timers y pageshow no reinicia el tiempo restante', async () => {
  const reloj = crearRelojFalso();
  const { destino, ventana } = crearEntorno();
  let expiraciones = 0;
  let actividades = 0;
  const control = crearControlInactividad({
    destino, ventana,
    ahora: reloj.ahora,
    programar: reloj.programar,
    cancelar: reloj.cancelar,
    alExpirar: () => { expiraciones += 1; },
    alRegistrarActividad: () => { actividades += 1; },
  });
  control.iniciar();
  reloj.avanzar(TIEMPO_INACTIVIDAD_ADMIN_MS - 1000);
  ventana.dispatchEvent(new Event('pagehide'));
  assert.equal(control.activo, false);
  assert.equal(control.suspendido, true);
  assert.equal(reloj.cantidad(), 0);
  destino.dispatchEvent(new Event('click')); // el evento no está escuchándose durante la suspensión
  assert.equal(actividades, 0);
  ventana.dispatchEvent(new Event('pageshow'));
  assert.equal(control.activo, true);
  assert.equal(control.suspendido, false);
  reloj.avanzar(999);
  await esperarMicrotarea();
  assert.equal(expiraciones, 0);
  reloj.avanzar(1);
  await esperarMicrotarea();
  assert.equal(expiraciones, 1);
});

test('detener limpia temporizadores y eventos al cerrar sesión o abandonar el panel', () => {
  const reloj = crearRelojFalso();
  const { destino, ventana } = crearEntorno();
  let expiraciones = 0;
  let actividades = 0;
  const control = crearControlInactividad({
    destino, ventana,
    ahora: reloj.ahora,
    programar: reloj.programar,
    cancelar: reloj.cancelar,
    alExpirar: () => { expiraciones += 1; },
    alRegistrarActividad: () => { actividades += 1; },
  });
  control.iniciar();
  control.detener();
  destino.dispatchEvent(new Event('click'));
  ventana.dispatchEvent(new Event('pageshow'));
  reloj.avanzar(TIEMPO_INACTIVIDAD_ADMIN_MS * 2);
  assert.equal(control.activo, false);
  assert.equal(control.suspendido, false);
  assert.equal(reloj.cantidad(), 0);
  assert.equal(expiraciones, 0);
  assert.equal(actividades, 0);
});

test('RLS exige administrador y sesión Auth activa para CRUD en las cuatro tablas', () => {
  const migracion = leer('supabase/migraciones/002-sesion-admin-inactividad.sql');
  const schema = leer('supabase/schema.sql');
  for (const tabla of ['mesas', 'horarios', 'platos', 'reservas']) {
    const politica = migracion.match(new RegExp(`create policy \\\"El admin gestiona ${tabla === 'platos' ? 'la carta' : tabla}\\\"[\\s\\S]*?;`, 'i'))?.[0];
    assert.ok(politica, `falta política administrativa para ${tabla}`);
    assert.match(politica, /public\.es_admin\(\)\s+and\s+public\.sesion_admin_activa\(\)/i);
    assert.match(politica, /with check \(public\.es_admin\(\) and public\.sesion_admin_activa\(\)\)/i);
    assert.match(schema, new RegExp(`public\\.${tabla === 'platos' ? 'platos' : tabla}`));
  }
  assert.match(migracion, /alter table public\.reservas enable row level security/);
  assert.match(migracion, /auth\.sessions/);
  assert.match(migracion, /ultima_actividad > now\(\) - interval '5 minutes'/);
  assert.match(migracion, /ultima_actividad > now\(\) - interval '5 minutes'\s*;/);
  assert.match(migracion, /grant execute on function public\.registrar_actividad_admin\(\) to authenticated/);
  assert.doesNotMatch(migracion, /grant execute on function public\.registrar_actividad_admin\(\) to anon/);
  assert.match(migracion, /a\.ultima_actividad > now\(\) - interval '5 minutes'/);
  assert.match(migracion, /from pg_policies[\s\S]*?execute format\('drop policy if exists %I on public\.%I'/i);
  assert.match(migracion, /POLITICA_RLS_NO_RECONOCIDA/);
  assert.match(migracion, /v_politica\.policyname not in/);
  assert.match(migracion, /create policy \"Todos ven las mesas\"[\s\S]*?for select to anon, authenticated/i);
  assert.match(migracion, /not exists \(select 1 from auth\.sessions s where s\.id = a\.session_id\)/);
});

test('las lecturas públicas siguen disponibles y las consultas sensibles requieren sesión admin', () => {
  const supabase = leer('js/supabase.js');
  assert.match(supabase, /export async function obtenerMesas[\s\S]*?export async function obtenerHorarios/);
  assert.match(supabase, /export async function crearReserva/);
  for (const funcion of [
    'obtenerReservas', 'obtenerReservasAnalisis', 'guardarMesa', 'borrarMesa',
    'cambiarEstadoMesa', 'guardarHorario', 'cambiarEstadoReserva', 'guardarPlato',
    'borrarPlato', 'cambiarDisponibilidadPlato',
  ]) {
    const inicio = supabase.indexOf(`export async function ${funcion}(`);
    assert.notEqual(inicio, -1, `falta función ${funcion}`);
    const cuerpo = supabase.slice(inicio, supabase.indexOf('\n}', inicio) + 2);
    assert.match(cuerpo, /await exigirSesionAdmin\(\)/, `${funcion} debe validar sesión antes de operar`);
  }
});

test('no se añaden mecanismos alternativos de almacenamiento en los scripts desplegados', () => {
  const archivos = readdirSync(join(raiz, 'js')).filter((nombre) => nombre.endsWith('.js'));
  for (const archivo of archivos) {
    const codigo = leer(`js/${archivo}`);
    assert.doesNotMatch(codigo, /\b(?:localStorage|sessionStorage)\b|document\.cookie/i, archivo);
  }
});
