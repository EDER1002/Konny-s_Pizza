// =====================================================================
// logica.js — Funciones de apoyo que no tocan la página ni Supabase.
// Las usan cliente.js y admin.js, y se prueban con `npm test`.
// =====================================================================

// Días como se guardan en la tabla horarios (getDay(): 0 = domingo).
const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const NOMBRES_DIA = {
  lunes: 'Lunes', martes: 'Martes', miercoles: 'Miércoles', jueves: 'Jueves',
  viernes: 'Viernes', sabado: 'Sábado', domingo: 'Domingo',
};
const DIAS_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export const CATEGORIAS = [
  { id: 'pizzas', titulo: 'Pizzas' },
  { id: 'entradas', titulo: 'Entradas' },
  { id: 'postres', titulo: 'Postres' },
  { id: 'bebidas', titulo: 'Bebidas' },
];
export const ORDEN_DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];

// Días hacia adelante que se pueden reservar (igual que en la base de datos).
export const DIAS_PARA_RESERVAR = 30;

// ---------- Horas ----------

// '12:30' o '12:30:00' -> 750 minutos.
export function aMinutos(hora) {
  const [h, m] = String(hora).split(':').map(Number);
  return h * 60 + m;
}

// 750 -> '12:30'
export function aHora(minutos) {
  const h = String(Math.floor(minutos / 60)).padStart(2, '0');
  const m = String(minutos % 60).padStart(2, '0');
  return `${h}:${m}`;
}

// ---------- Fechas ('YYYY-MM-DD', siempre en hora local) ----------

function aFecha(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(a, m - 1, d);
}

function aISO(fecha) {
  const a = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  const d = String(fecha.getDate()).padStart(2, '0');
  return `${a}-${m}-${d}`;
}

export function hoyISO(ahora = new Date()) {
  return aISO(ahora);
}

export function horaActual(ahora = new Date()) {
  return aHora(ahora.getHours() * 60 + ahora.getMinutes());
}

export function sumarDias(iso, dias) {
  const fecha = aFecha(iso);
  fecha.setDate(fecha.getDate() + dias);
  return aISO(fecha);
}

// '2026-10-31' -> 'sabado'
export function diaSemana(iso) {
  return DIAS[aFecha(iso).getDay()];
}

export function nombreDia(dia) {
  return NOMBRES_DIA[dia] || dia;
}

// 'sábado 31 de octubre de 2026'
export function fechaLarga(iso) {
  const f = aFecha(iso);
  return `${nombreDia(DIAS[f.getDay()]).toLowerCase()} ${f.getDate()} de ${MESES[f.getMonth()]} de ${f.getFullYear()}`;
}

// 'Sáb 17 oct 2026'
export function fechaCorta(iso) {
  const f = aFecha(iso);
  return `${DIAS_CORTOS[f.getDay()]} ${f.getDate()} ${MESES_CORTOS[f.getMonth()]} ${f.getFullYear()}`;
}

// 'hoy', 'mañana' o 'el sáb 31 oct', según qué tan lejos esté la fecha.
export function cuandoEs(fecha, hoy) {
  if (fecha === hoy) return 'hoy';
  if (fecha === sumarDias(hoy, 1)) return 'mañana';
  const f = aFecha(fecha);
  return `el ${DIAS_CORTOS[f.getDay()].toLowerCase()} ${f.getDate()} ${MESES_CORTOS[f.getMonth()]}`;
}

export function nombreMes(mes) {
  const nombre = MESES[mes];
  return nombre.charAt(0).toUpperCase() + nombre.slice(1);
}

// ---------- Slots ----------

// Bloques de reserva de un día, a partir de las jornadas activas.
// Ej: jornada 12:30-14:30 con slots de 60 -> 12:30-13:30 y 13:30-14:30.
export function generarSlots(horarios, dia) {
  const slots = new Map();
  horarios
    .filter((h) => h.dia_semana === dia && h.activo)
    .forEach((h) => {
      const fin = aMinutos(h.hora_fin);
      const paso = Number(h.duracion_slot);
      for (let t = aMinutos(h.hora_inicio); t + paso <= fin; t += paso) {
        slots.set(t, { inicio: aHora(t), fin: aHora(t + paso) });
      }
    });
  return [...slots.entries()].sort((a, b) => a[0] - b[0]).map(([, s]) => s);
}

// ¿Dos bloques de tiempo se cruzan? (uno que termina 13:30 y otro que empieza 13:30 no se cruzan)
export function seCruzan(a, b) {
  return aMinutos(a.inicio) < aMinutos(b.fin) && aMinutos(b.inicio) < aMinutos(a.fin);
}

// Pone a cada slot su estado: 'libre', 'ocupado' o 'pasado'.
// ocupados: reservas de esa mesa ese día [{ hora_inicio, hora_fin }].
export function marcarSlots(slots, ocupados = [], { esHoy = false, ahora = '00:00' } = {}) {
  return slots.map((slot) => {
    let estado = 'libre';
    if (esHoy && aMinutos(slot.inicio) <= aMinutos(ahora)) {
      estado = 'pasado';
    } else if (ocupados.some((o) => seCruzan(slot, { inicio: o.hora_inicio, fin: o.hora_fin }))) {
      estado = 'ocupado';
    }
    return { ...slot, estado };
  });
}

// Estado general de una mesa para hoy, según sus slots ya marcados.
export function estadoMesaHoy(slotsMarcados) {
  const futuros = slotsMarcados.filter((s) => s.estado !== 'pasado');
  if (futuros.length === 0) return 'cerrado';
  return futuros.some((s) => s.estado === 'libre') ? 'libre' : 'ocupada';
}

// Texto del horario para el pie de página, armado con lo que hay en la tabla horarios.
export function resumenHorario(horarios) {
  const porDia = ORDEN_DIAS.map((dia) => horarios
    .filter((h) => h.dia_semana === dia && h.activo)
    .sort((a, b) => aMinutos(a.hora_inicio) - aMinutos(b.hora_inicio))
    .map((h) => `de ${String(h.hora_inicio).slice(0, 5)} a ${String(h.hora_fin).slice(0, 5)}`)
    .join(' y '));
  if (porDia.every((texto) => !texto)) return 'Por ahora no hay horarios de atención.';
  if (porDia.every((texto) => texto === porDia[0])) return `Todos los días, ${porDia[0]}.`;
  return ORDEN_DIAS.map((dia, i) => `${nombreDia(dia)}: ${porDia[i] || 'cerrado'}.`).join(' ');
}

// Fechas que se pueden elegir: desde hoy hasta DIAS_PARA_RESERVAR días,
// solo si ese día tiene horario. Hoy sale si todavía quedan slots.
export function fechasDisponibles(horarios, hoy, ahora, dias = DIAS_PARA_RESERVAR) {
  const fechas = [];
  for (let i = 0; i <= dias; i++) {
    const fecha = sumarDias(hoy, i);
    const slots = generarSlots(horarios, diaSemana(fecha));
    const quedan = i === 0 ? slots.some((s) => aMinutos(s.inicio) > aMinutos(ahora)) : slots.length > 0;
    if (quedan) fechas.push(fecha);
  }
  return fechas;
}

// Semanas de un mes para pintar el calendario (lunes a domingo).
// mes: 0 = enero. Los huecos antes del día 1 y después del último son null.
export function construirMes(anio, mes) {
  const primero = new Date(anio, mes, 1);
  const diasDelMes = new Date(anio, mes + 1, 0).getDate();
  const huecos = (primero.getDay() + 6) % 7; // lunes = 0
  const celdas = Array(huecos).fill(null);
  for (let d = 1; d <= diasDelMes; d++) celdas.push(aISO(new Date(anio, mes, d)));
  while (celdas.length % 7 !== 0) celdas.push(null);
  const semanas = [];
  for (let i = 0; i < celdas.length; i += 7) semanas.push(celdas.slice(i, i + 7));
  return semanas;
}

// ---------- Validación del formulario de reserva ----------

export function validarReserva({ nombre = '', personas, contacto = '' }, capacidad) {
  const errores = {};
  const nombreLimpio = String(nombre).trim();
  if (nombreLimpio.length < 2 || nombreLimpio.length > 80) {
    errores.nombre = 'Escribe tu nombre (mínimo 2 letras).';
  } else if (/[<>\u0000-\u001f\u007f]/.test(nombreLimpio)) {
    // Mismo criterio que la base de datos: sin etiquetas ni caracteres de control.
    errores.nombre = 'El nombre no puede llevar los símbolos < o >.';
  }

  const num = Number(personas);
  if (personas === '' || personas === null || personas === undefined || !Number.isInteger(num) || num < 1) {
    errores.personas = 'Escribe el número de personas.';
  } else if (num > capacidad) {
    errores.personas = `Esta mesa es para máximo ${capacidad} personas.`;
  }

  const contactoLimpio = String(contacto || '').trim();
  if (contactoLimpio && !/^[0-9+() -]{7,20}$/.test(contactoLimpio)) {
    errores.contacto = 'Escribe un teléfono válido o déjalo vacío.';
  }

  return { valido: Object.keys(errores).length === 0, errores };
}

// ---------- Mensajes de error para mostrar en pantalla ----------

const MENSAJES = [
  ['SLOT_OCUPADO', () => 'Ese horario acaba de ser reservado por otra persona. Elige otro, por favor.'],
  ['reservas_sin_cruce', () => 'Ese horario se cruza con otra reserva de la misma mesa.'],
  ['CAPACIDAD_EXCEDIDA', (e) => e.details || 'Hay más personas de las que caben en la mesa.'],
  ['MESA_NO_DISPONIBLE', () => 'Esta mesa ya no está disponible. Elige otra, por favor.'],
  ['HORARIO_INVALIDO', () => 'Ese horario no está disponible para el día elegido.'],
  ['FECHA_INVALIDA', () => 'Esa fecha u hora ya no se puede reservar. Elige otra.'],
  ['NOMBRE_INVALIDO', () => 'Escribe tu nombre (mínimo 2 letras).'],
  ['PERSONAS_INVALIDAS', () => 'Escribe el número de personas.'],
  ['CONTACTO_INVALIDO', () => 'Escribe un teléfono válido (solo números, +, espacios o guiones) o déjalo vacío.'],
  ['DEMASIADAS_RESERVAS', () => 'Has hecho muchas reservas en poco tiempo. Espera un rato o escríbenos por WhatsApp.'],
  ['mesas_foto_check', () => 'La foto debe ser un enlace que empiece por https://'],
  ['mesas_nombre_unico', () => 'Ya existe una mesa con ese nombre.'],
  ['reservas_mesa_id_fkey', () => 'No se puede borrar: la mesa tiene reservas. Mejor desactívala.'],
  ['horarios_horas_check', () => 'La hora de cierre debe ser mayor que la de apertura.'],
  ['horarios_duracion_check', () => 'La duración de la reserva debe estar entre 15 y 240 minutos.'],
  ['platos_precio_check', () => 'El precio no puede ser negativo.'],
  ['mesas_capacidad_check', () => 'La capacidad debe estar entre 1 y 20 personas.'],
  ['NO_ES_ADMIN', () => 'Este usuario no es administrador. Revisa la tabla administradores en Supabase.'],
  ['Invalid login credentials', () => 'Correo o contraseña incorrectos.'],
  ['Email not confirmed', () => 'Primero confirma el correo del administrador en Supabase.'],
  ['JWT expired', () => 'Tu sesión expiró. Vuelve a iniciar sesión.'],
  ['row-level security', () => 'No tienes permiso para hacer esto. Inicia sesión como administrador.'],
  ['permission denied', () => 'No tienes permiso para hacer esto. Inicia sesión como administrador.'],
  ['check constraint', () => 'Algún dato no es válido. Revisa el formulario.'],
  ['Failed to fetch', () => 'No hay conexión con el servidor. Revisa tu internet e intenta de nuevo.'],
  ['NetworkError', () => 'No hay conexión con el servidor. Revisa tu internet e intenta de nuevo.'],
  ['Load failed', () => 'No hay conexión con el servidor. Revisa tu internet e intenta de nuevo.'],
];

export const MENSAJE_GENERICO = 'Ocurrió un error inesperado. Intenta de nuevo.';

export function mensajeError(error) {
  const texto = `${error?.message || ''} ${error?.code || ''}`;
  const encontrado = MENSAJES.find(([clave]) => texto.includes(clave));
  return encontrado ? encontrado[1](error) : MENSAJE_GENERICO;
}

// ---------- Formatos y utilidades ----------

// 42000 -> '$42.000'
export function formatoPrecio(valor) {
  return '$' + String(Math.round(Number(valor) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// Ordena por nombre como lo haría una persona: Mesa 2 antes que Mesa 10.
export function ordenarMesas(mesas) {
  return [...mesas].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));
}

export function nombreZona(zona) {
  return zona === 'salon' ? 'Salón' : zona === 'terraza' ? 'Terraza' : zona;
}

// Divide una lista en páginas. pagina empieza en 1.
export function paginar(lista, pagina, porPagina) {
  const total = lista.length;
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));
  const actual = Math.min(Math.max(1, pagina), totalPaginas);
  const desde = (actual - 1) * porPagina;
  return { items: lista.slice(desde, desde + porPagina), pagina: actual, totalPaginas, total };
}

// Agrupa la carta por categoría (en el orden del menú) y quita lo no disponible.
export function agruparPlatos(platos) {
  return CATEGORIAS
    .map((c) => ({ categoria: c.id, titulo: c.titulo, platos: platos.filter((p) => p.disponible && p.categoria === c.id) }))
    .filter((g) => g.platos.length > 0);
}

// Evita que un texto escrito por un usuario se interprete como HTML.
export function escaparHTML(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
