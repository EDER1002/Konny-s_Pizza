import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInsights } from '../js/recomendaciones.js';

const ahora = new Date('2026-10-20T17:00:00.000Z');
const fila = (cambios = {}) => ({
  fecha: '2026-10-21', hora_inicio: '19:00:00', num_personas: 2,
  estado: 'confirmada', capacidad: 4, ...cambios,
});

test('calcula KPI diferenciando confirmadas futuras, pasadas, completadas y canceladas', () => {
  const r = buildInsights([
    fila(),
    fila({ fecha: '2026-10-19', hora_inicio: '19:00' }),
    fila({ estado: 'completada', fecha: '2026-10-18' }),
    fila({ estado: 'cancelada' }),
  ], ahora);
  assert.equal(r.kpis.total, 4);
  assert.equal(r.kpis.confirmadasFuturas, 1);
  assert.equal(r.kpis.confirmadasPasadas, 1);
  assert.equal(r.kpis.completadas, 1);
  assert.equal(r.kpis.canceladas, 1);
});

test('la hora exacta de inicio ya ocurrida no cuenta como futura', () => {
  const r = buildInsights([fila({ fecha: '2026-10-20', hora_inicio: '12:00' })], ahora);
  assert.equal(r.kpis.confirmadasFuturas, 0);
  assert.equal(r.kpis.confirmadasPasadas, 1);
});

test('incluye confirmadas y completadas en demanda, pero excluye canceladas', () => {
  const r = buildInsights([
    fila({ fecha: '2026-10-21', estado: 'confirmada' }),
    fila({ fecha: '2026-10-21', estado: 'completada', hora_inicio: '20:00' }),
    fila({ fecha: '2026-10-21', estado: 'cancelada', hora_inicio: '21:00' }),
  ], ahora);
  assert.equal(r.porDia.find((x) => x.label === 'Miércoles').total, 2);
  assert.deepEqual(r.porHora, [{ label: '19:00', total: 1 }, { label: '20:00', total: 1 }]);
});

test('muestra los siete días en orden domingo a sábado con ceros', () => {
  const r = buildInsights([], ahora);
  assert.deepEqual(r.porDia.map((x) => x.label), ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']);
  assert.ok(r.porDia.every((x) => x.total === 0));
});

test('agrupa horas y las ordena cronológicamente aceptando HH:MM y HH:MM:SS', () => {
  const r = buildInsights([
    fila({ hora_inicio: '20:00' }),
    fila({ hora_inicio: '09:30:00' }),
    fila({ hora_inicio: '09:30' }),
    fila({ hora_inicio: '18:15:59' }),
  ], ahora);
  assert.deepEqual(r.porHora, [
    { label: '09:30', total: 2 },
    { label: '18:15', total: 1 },
    { label: '20:00', total: 1 },
  ]);
  assert.equal(r.horaPico.label, '09:30');
});

test('fechas invalidas no desplazan el día ni generan agrupación', () => {
  const r = buildInsights([fila({ fecha: '2026-02-30' }), fila({ fecha: 'no-fecha' })], ahora);
  assert.equal(r.kpis.fechasInvalidas, 2);
  assert.ok(r.porDia.every((x) => x.total === 0));
});

test('horas inválidas no se agrupan y sí se conserva la demanda por día', () => {
  const r = buildInsights([fila({ hora_inicio: '25:61' })], ahora);
  assert.equal(r.kpis.horasInvalidas, 1);
  assert.equal(r.porDia.find((x) => x.label === 'Miércoles').total, 1);
  assert.equal(r.porHora.length, 0);
});

test('cruce de mes y año conserva el día calendario', () => {
  const r = buildInsights([
    fila({ fecha: '2026-12-31' }),
    fila({ fecha: '2027-01-01' }),
  ], ahora);
  assert.equal(r.porDia.find((x) => x.label === 'Jueves').total, 1);
  assert.equal(r.porDia.find((x) => x.label === 'Viernes').total, 1);
});

test('ocupación es promedio de proporciones, no razón de sumas', () => {
  const r = buildInsights([
    fila({ num_personas: 2, capacidad: 4 }), // 50%
    fila({ num_personas: 6, capacidad: 8 }), // 75%
  ], ahora);
  assert.equal(r.kpis.ocupacion, 63);
  assert.equal(r.kpis.ocupacionMuestras, 2);
});

test('excluye canceladas del cálculo de ocupación', () => {
  const r = buildInsights([
    fila({ num_personas: 2, capacidad: 4 }),
    fila({ estado: 'cancelada', num_personas: 4, capacidad: 4 }),
  ], ahora);
  assert.equal(r.kpis.ocupacion, 50);
  assert.equal(r.kpis.ocupacionMuestras, 1);
});

test('capacidad cero, negativa, nula o mesa no encontrada no se inventa', () => {
  const r = buildInsights([
    fila({ capacidad: 0 }),
    fila({ capacidad: -2 }),
    fila({ capacidad: null }),
    fila({ capacidad: undefined }),
  ], ahora);
  assert.equal(r.kpis.ocupacion, null);
  assert.equal(r.kpis.ocupacionMuestras, 0);
  assert.equal(r.kpis.ocupacionIncompletas, 4);
});

test('personas nulas o no numéricas se excluyen de ocupación', () => {
  const r = buildInsights([
    fila({ num_personas: null }),
    fila({ num_personas: 'no-numero' }),
  ], ahora);
  assert.equal(r.kpis.ocupacion, null);
  assert.equal(r.kpis.ocupacionIncompletas, 2);
});

test('mesas históricas inactivas siguen siendo analizables si tienen capacidad', () => {
  const r = buildInsights([fila({ capacidad: 4 })], ahora);
  assert.equal(r.kpis.ocupacion, 50);
});

test('redondea el promedio al entero más cercano y activa umbral de 80%', () => {
  const r = buildInsights([fila({ num_personas: 4, capacidad: 5 })], ahora);
  assert.equal(r.kpis.ocupacion, 80);
  assert.ok(r.recomendaciones.some((x) => x.title === 'Ocupación estimada elevada'));
});

test('no recomienda ocupación cuando faltan datos para calcularla', () => {
  const r = buildInsights([fila({ capacidad: null })], ahora);
  assert.equal(r.kpis.ocupacion, null);
  assert.ok(!r.recomendaciones.some((x) => x.title === 'Ocupación estimada elevada'));
});

test('recomendaciones incluyen motivo, evidencia y acción administrativa', () => {
  const r = buildInsights([
    fila({ estado: 'cancelada' }),
    fila({ num_personas: 4, capacidad: 4 }),
  ], ahora);
  for (const recomendacion of r.recomendaciones) {
    assert.ok(recomendacion.title);
    assert.ok(recomendacion.detail);
    assert.ok(recomendacion.reason);
    assert.ok(recomendacion.evidence);
    assert.ok(recomendacion.action);
  }
});

test('lista vacía devuelve ceros y ocupación no calculable, sin hora pico', () => {
  const r = buildInsights([], ahora);
  assert.equal(r.kpis.total, 0);
  assert.equal(r.kpis.ocupacion, null);
  assert.equal(r.horaPico, null);
  assert.equal(r.porHora.length, 0);
  assert.equal(r.recomendaciones.length, 1);
});

test('entrada no-array y fila incompleta son toleradas sin lanzar excepción', () => {
  assert.equal(buildInsights(null, ahora).kpis.total, 0);
  const r = buildInsights([null, {}, fila({ estado: 'otro' })], ahora);
  assert.equal(r.kpis.total, 3);
  assert.equal(r.porHora.length, 0);
});

test('no modifica el arreglo de entrada ni sus filas', () => {
  const rows = [fila(), fila({ hora_inicio: '08:00' })];
  const copia = structuredClone(rows);
  buildInsights(rows, ahora);
  assert.deepEqual(rows, copia);
});

test('capacidad no numérica y estados desconocidos no alteran la ocupación', () => {
  const r = buildInsights([
    fila({ capacidad: 'sin-dato' }),
    fila({ estado: 'estado-desconocido', capacidad: 4, num_personas: 4 }),
  ], ahora);
  assert.equal(r.kpis.ocupacion, null);
  assert.equal(r.kpis.ocupacionIncompletas, 1);
  assert.equal(r.porHora.length, 1); // la primera reserva sí cuenta en demanda aunque no en ocupación
});

test('comparación de fecha y hora cerca de medianoche usa America/Bogota', () => {
  const antesDeMedianoche = new Date('2026-10-21T04:59:00.000Z'); // 23:59 en Bogotá
  const r = buildInsights([
    fila({ fecha: '2026-10-21', hora_inicio: '00:01' }),
  ], antesDeMedianoche);
  assert.equal(r.kpis.confirmadasFuturas, 1);
});

test('resultado determinista con referencia temporal inyectada', () => {
  const rows = [fila()];
  assert.deepEqual(buildInsights(rows, ahora), buildInsights(rows, new Date(ahora.getTime())));
});
