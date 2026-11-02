// =====================================================================
// recomendaciones.js — Análisis puro de reservas, sin DOM ni Supabase.
// Las fechas DATE y horas TIME se interpretan como calendario local del
// restaurante (America/Bogota): nunca se convierten desde/hacia UTC.
// =====================================================================
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const ESTADOS = new Set(['confirmada', 'cancelada', 'completada']);

function leerFecha(fecha) {
  if (typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null;
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const fechaUTC = new Date(Date.UTC(anio, mes - 1, dia));
  if (fechaUTC.getUTCFullYear() !== anio || fechaUTC.getUTCMonth() !== mes - 1 || fechaUTC.getUTCDate() !== dia) return null;
  return { anio, mes, dia };
}

function leerHora(hora) {
  if (typeof hora !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?$/.test(hora)) return null;
  const [h, m] = hora.split(':').map(Number);
  return { h, m, minutos: h * 60 + m };
}

function claveFechaHora(fecha, hora) {
  const f = leerFecha(fecha);
  const h = leerHora(hora);
  if (!f || !h) return null;
  return `${fecha}T${String(h.h).padStart(2, '0')}:${String(h.m).padStart(2, '0')}`;
}

function ahoraEnBogota(now) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const valor = Object.fromEntries(partes.map((p) => [p.type, p.value]));
  return `${valor.year}-${valor.month}-${valor.day}T${valor.hour}:${valor.minute}`;
}

/**
 * Entrada: filas minimizadas {fecha, hora_inicio, num_personas, estado, capacidad}.
 * `now` es Date inyectable, interpretado en la zona local del navegador
 * (la aplicación se opera en Bucaramanga / America/Bogota).
 *
 * Demanda: confirmadas + completadas; canceladas y estados desconocidos se excluyen.
 * Ocupación: promedio de personas/capacidad por reserva no cancelada con ambos
 * valores positivos y finitos. Filas sin capacidad/personas válidas se excluyen
 * y se contabilizan en ocupacionIncompletas. Mesas inactivas se conservan para
 * no perder el contexto histórico de reservas antiguas.
 */
export function buildInsights(rows = [], now = new Date()) {
  const reservas = Array.isArray(rows) ? rows : [];
  const referencia = now instanceof Date && Number.isFinite(now.getTime()) ? now : new Date();
  const canceladas = reservas.filter((r) => r?.estado === 'cancelada').length;
  const completadas = reservas.filter((r) => r?.estado === 'completada').length;
  const confirmadas = reservas.filter((r) => r?.estado === 'confirmada');
  const referenciaBogota = ahoraEnBogota(referencia);
  const confirmadasFuturas = confirmadas.filter((r) => {
    const inicio = claveFechaHora(r.fecha, r.hora_inicio);
    return inicio !== null && inicio > referenciaBogota;
  }).length;
  const confirmadasPasadas = confirmadas.filter((r) => {
    const inicio = claveFechaHora(r.fecha, r.hora_inicio);
    return inicio !== null && inicio <= referenciaBogota;
  }).length;

  const demanda = reservas.filter((r) => r && (r.estado === 'confirmada' || r.estado === 'completada'));
  const porDia = DIAS.map((label) => ({ label, total: 0 }));
  const conteoHoras = new Map();
  let sumaProporciones = 0;
  let ocupacionMuestras = 0;
  let ocupacionIncompletas = 0;
  let fechasInvalidas = 0;
  let horasInvalidas = 0;

  for (const r of reservas) {
    if (!r || (r.estado !== 'confirmada' && r.estado !== 'completada')) continue;
    const capacidad = Number(r.capacidad);
    const personas = Number(r.num_personas);
    if (Number.isFinite(capacidad) && capacidad > 0 && Number.isFinite(personas) && personas > 0) {
      sumaProporciones += personas / capacidad;
      ocupacionMuestras += 1;
    } else {
      ocupacionIncompletas += 1;
    }
  }

  for (const r of demanda) {
    const f = leerFecha(r.fecha);
    if (!f) {
      fechasInvalidas += 1;
      continue;
    }
    porDia[new Date(Date.UTC(f.anio, f.mes - 1, f.dia)).getUTCDay()].total += 1;
    const h = leerHora(r.hora_inicio);
    if (!h) {
      horasInvalidas += 1;
      continue;
    }
    const etiqueta = `${String(h.h).padStart(2, '0')}:${String(h.m).padStart(2, '0')}`;
    conteoHoras.set(etiqueta, (conteoHoras.get(etiqueta) || 0) + 1);
  }

  const porHora = [...conteoHoras.entries()]
    .map(([label, total]) => ({ label, total }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const pico = porHora.reduce((mayor, actual) => actual.total > (mayor?.total || 0) ? actual : mayor, null);
  const ocupacion = ocupacionMuestras
    ? Math.round((sumaProporciones / ocupacionMuestras) * 100)
    : null;

  const recomendaciones = [];
  if (canceladas > 0) recomendaciones.push({
    title: 'Revisar las cancelaciones',
    detail: `Hay ${canceladas} reserva(s) cancelada(s) de ${reservas.length} registros. La muestra justifica revisar su frecuencia y distribución.`,
    reason: 'Se genera porque existen registros cuyo estado es exactamente cancelada.',
    evidence: `${canceladas} cancelada(s) / ${reservas.length} reserva(s) registradas`,
    action: 'Revisar fechas y horarios de las cancelaciones antes de cambiar la operación.',
  });
  if (pico) recomendaciones.push({
    title: 'Franja con mayor demanda registrada',
    detail: `La hora ${pico.label} reúne ${pico.total} reserva(s) no cancelada(s), más que las demás horas de la muestra. Esto identifica concentración relativa, no saturación.`,
    reason: 'Se compara el número de reservas confirmadas y completadas por hora de inicio.',
    evidence: `${pico.label}: ${pico.total} reserva(s)`,
    action: 'Revisar la planificación de mesas y personal para esa franja, contrastándola con la operación real.',
  });
  if (ocupacion !== null && ocupacion >= 80) recomendaciones.push({
    title: 'Ocupación estimada elevada',
    detail: `El promedio estimado es ${ocupacion}% en ${ocupacionMuestras} reserva(s) con datos completos.`,
    reason: 'El promedio de personas reservadas dividido por la capacidad registrada de sus mesas alcanzó o superó el 80%.',
    evidence: `${ocupacion}% de ocupación estimada; ${ocupacionIncompletas} registro(s) incompleto(s) excluido(s)`,
    action: 'Revisar la asignación de mesas y la calidad de las capacidades registradas.',
  });
  if (!recomendaciones.length) recomendaciones.push({
    title: 'Sin alertas destacadas',
    detail: 'Con los registros disponibles no se activan las reglas de alerta actuales. Esto no garantiza que no existan problemas operativos.',
    reason: 'No hay cancelaciones, no se identifica una hora con reservas o la ocupación estimada no alcanza el umbral.',
    evidence: `${reservas.length} registro(s); ${ocupacionMuestras} muestra(s) válida(s) para ocupación`,
    action: 'Volver a consultar el análisis cuando se registren nuevas reservas.',
  });

  return {
    kpis: {
      total: reservas.length,
      confirmadasFuturas: confirmadasFuturas,
      confirmadasPasadas,
      completadas,
      canceladas,
      ocupacion,
      ocupacionMuestras,
      ocupacionIncompletas,
      fechasInvalidas,
      horasInvalidas,
    },
    porDia,
    porHora,
    horaPico: pico,
    recomendaciones,
  };
}
