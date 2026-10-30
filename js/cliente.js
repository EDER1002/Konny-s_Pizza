// =====================================================================
// cliente.js — Página principal: mesas (RF-01, RF-02), reserva
// (RF-03 a RF-06) y carta digital (RF-07).
// =====================================================================
import {
  faltaConfiguracion, obtenerMesas, obtenerHorarios, obtenerOcupados, crearReserva,
  obtenerPlatos, escucharCambios,
} from './supabase.js';
import {
  aMinutos, hoyISO, horaActual, sumarDias, diaSemana, generarSlots, marcarSlots, seCruzan,
  estadoMesaHoy, fechasDisponibles, construirMes, nombreMes, validarReserva, mensajeError,
  formatoPrecio, fechaCorta, fechaLarga, agruparPlatos, escaparHTML, nombreZona, DIAS_PARA_RESERVAR, cuandoEs, resumenHorario,
} from './logica.js';
import { abrirModal, conPausa, AVISO_CONFIG } from './ui.js';

const $ = (selector) => document.querySelector(selector);

const ui = {
  menuBoton: $('.menu-boton'),
  menu: $('#menu-principal'),
  horarioHoy: $('#horario-hoy'),
  horarioPie: $('#horario-pie'),
  listaMesas: $('#lista-mesas'),
  pestanas: $('#carta-pestanas'),
  carta: $('#carta-lista'),
  modal: $('#modal-reserva'),
  titulo: $('#reserva-titulo'),
  subtitulo: $('#reserva-subtitulo'),
  form: $('#form-reserva'),
  calendario: $('#calendario'),
  slots: $('#slots'),
  resumen: $('#resumen'),
  errorReserva: $('#error-reserva'),
  botonConfirmar: $('#boton-confirmar'),
  ayudaPersonas: $('#ayuda-personas'),
  confirmacion: $('#confirmacion'),
  confirmacionDatos: $('#confirmacion-datos'),
};

// Todo lo que la página necesita recordar.
const estado = {
  mesas: [],
  horarios: [],
  fechaEstado: null,   // día que se usa para el estado de las tarjetas
  ocupadosEstado: [],  // slots ocupados de ese día
  platos: [],
  categoria: null,
  reserva: null, // { mesa, fechas, fecha, slot, ocupados, mes: { anio, mes }, confirmada }
};

let temporizadorSlots = null;

// ---------------------------------------------------------------------
// Menú del celular
// ---------------------------------------------------------------------
ui.menuBoton.addEventListener('click', () => {
  const abierto = ui.menu.classList.toggle('abierto');
  ui.menuBoton.setAttribute('aria-expanded', String(abierto));
});
ui.menu.addEventListener('click', (evento) => {
  if (evento.target.closest('a')) {
    ui.menu.classList.remove('abierto');
    ui.menuBoton.setAttribute('aria-expanded', 'false');
  }
});

// ---------------------------------------------------------------------
// Carga de datos
// ---------------------------------------------------------------------
async function cargarTodo() {
  try {
    const [mesas, horarios, platos] = await Promise.all([
      obtenerMesas({ soloActivas: true }),
      obtenerHorarios(),
      obtenerPlatos({ soloDisponibles: true }),
    ]);
    // El estado de las tarjetas es el de hoy o, si hoy ya cerramos, el del próximo día que abrimos.
    const fechaEstado = fechasDisponibles(horarios, hoyISO(), horaActual())[0] || null;
    const ocupadosEstado = fechaEstado ? await obtenerOcupados(fechaEstado) : [];
    Object.assign(estado, { mesas, horarios, platos, fechaEstado, ocupadosEstado });
    pintarHorarioHoy();
    pintarMesas();
    pintarCarta();
    actualizarReservaAbierta();
  } catch (error) {
    console.error(error);
    const aviso = `<div class="aviso aviso--error">${escaparHTML(mensajeError(error))}
      <br><button class="boton boton--oscuro boton--chico" type="button" data-reintentar>Intentar de nuevo</button></div>`;
    ui.listaMesas.innerHTML = aviso;
    ui.carta.innerHTML = aviso;
  }
}

document.addEventListener('click', (evento) => {
  if (evento.target.closest('[data-reintentar]')) cargarTodo();
});

// ---------------------------------------------------------------------
// Hero: horario de hoy
// ---------------------------------------------------------------------
function pintarHorarioHoy() {
  const jornadas = estado.horarios
    .filter((h) => h.dia_semana === diaSemana(hoyISO()) && h.activo)
    .sort((a, b) => aMinutos(a.hora_inicio) - aMinutos(b.hora_inicio));
  ui.horarioHoy.textContent = jornadas.length
    ? `Hoy atendemos ${jornadas.map((j) => `de ${j.hora_inicio.slice(0, 5)} a ${j.hora_fin.slice(0, 5)}`).join(' y ')}.`
    : 'Hoy no abrimos. Puedes reservar para otro día.';
  ui.horarioPie.textContent = resumenHorario(estado.horarios);
}

// ---------------------------------------------------------------------
// Mesas (RF-01)
// ---------------------------------------------------------------------
// Dibujo de la mesa vista desde arriba: una silla por cada persona.
function planoMesa(capacidad) {
  const cx = 80;
  const cy = 50;
  const radioMesa = Math.min(12 + capacidad * 2, 28);
  const radioSillas = radioMesa + 11;
  const tamano = capacidad > 10 ? 4 : 6;
  const sillas = Array.from({ length: capacidad }, (_, i) => {
    const angulo = (i / capacidad) * 2 * Math.PI - Math.PI / 2;
    const x = (cx + radioSillas * Math.cos(angulo)).toFixed(1);
    const y = (cy + radioSillas * Math.sin(angulo)).toFixed(1);
    return `<circle class="plano__silla" cx="${x}" cy="${y}" r="${tamano}"></circle>`;
  }).join('');
  return `<svg class="mesa__plano" viewBox="0 0 160 100" role="img" aria-label="Mesa para ${capacidad} personas">
    ${sillas}<circle class="plano__mesa" cx="${cx}" cy="${cy}" r="${radioMesa}"></circle></svg>`;
}

function textoEstado(estadoMesa) {
  if (estadoMesa === 'cerrado') return 'Sin horarios por ahora';
  const cuando = cuandoEs(estado.fechaEstado, hoyISO());
  return estadoMesa === 'libre' ? `Libre ${cuando}` : `Sin cupo ${cuando}`;
}

function pintarMesas() {
  if (!estado.mesas.length) {
    ui.listaMesas.innerHTML = '<p class="vacio">Todavía no hay mesas para reservar. Vuelve pronto.</p>';
    return;
  }
  const fecha = estado.fechaEstado;
  const slots = fecha ? generarSlots(estado.horarios, diaSemana(fecha)) : [];
  const opciones = { esHoy: fecha === hoyISO(), ahora: horaActual() };

  ui.listaMesas.innerHTML = estado.mesas.map((mesa) => {
    const ocupados = estado.ocupadosEstado.filter((o) => o.mesa_id === mesa.id);
    const estadoMesa = estadoMesaHoy(marcarSlots(slots, ocupados, opciones));
    const imagen = mesa.foto_url
      ? `<img src="${escaparHTML(mesa.foto_url)}" alt="Foto de ${escaparHTML(mesa.nombre)}" loading="lazy">`
      : planoMesa(mesa.capacidad);
    return `
      <article class="mesa mesa--${estadoMesa}">
        <div class="mesa__imagen">${imagen}</div>
        <div class="mesa__datos">
          <h3>${escaparHTML(mesa.nombre)}</h3>
          <p class="mesa__detalle">${nombreZona(mesa.zona)}, hasta ${mesa.capacidad} personas</p>
          <span class="estado estado--${estadoMesa}">${textoEstado(estadoMesa)}</span>
          <button class="boton boton--borde" type="button" data-mesa="${mesa.id}">Ver horarios</button>
        </div>
      </article>`;
  }).join('');
}

ui.listaMesas.addEventListener('click', (evento) => {
  const boton = evento.target.closest('[data-mesa]');
  if (boton) abrirReserva(Number(boton.dataset.mesa));
});

// ---------------------------------------------------------------------
// Reserva: abrir el modal (RF-02)
// ---------------------------------------------------------------------
function abrirReserva(mesaId) {
  const mesa = estado.mesas.find((m) => m.id === mesaId);
  if (!mesa) return;

  const fechas = fechasDisponibles(estado.horarios, hoyISO(), horaActual());
  const primera = fechas[0] || null;
  const [anio, mes] = (primera || hoyISO()).split('-').map(Number);
  estado.reserva = { mesa, fechas, fecha: null, slot: null, ocupados: [], mes: { anio, mes: mes - 1 }, confirmada: false };

  ui.titulo.textContent = `Reservar ${mesa.nombre}`;
  ui.subtitulo.textContent = `${nombreZona(mesa.zona)}, hasta ${mesa.capacidad} personas`;
  ui.form.reset();
  ui.form.personas.max = mesa.capacidad;
  ui.ayudaPersonas.textContent = `Máximo ${mesa.capacidad} personas en esta mesa.`;
  mostrarErroresCampos({});
  ocultarError();
  ui.form.hidden = false;
  ui.confirmacion.hidden = true;

  pintarCalendario();
  pintarResumen();
  if (primera) {
    seleccionarFecha(primera);
  } else {
    ui.slots.innerHTML = '<p class="vacio">No hay días con horario en los próximos 30 días.</p>';
  }

  abrirModal(ui.modal, { alCerrar: alCerrarReserva, enfocar: ui.calendario.querySelector('[aria-pressed="true"]') });

  // Mientras el modal está abierto, revisa cada 20 s si otra persona tomó un horario.
  clearInterval(temporizadorSlots);
  temporizadorSlots = setInterval(() => refrescarOcupados(), 20000);
}

function alCerrarReserva() {
  clearInterval(temporizadorSlots);
  const confirmada = estado.reserva?.confirmada;
  estado.reserva = null;
  if (confirmada) {
    cargarTodo();
    document.getElementById('inicio').scrollIntoView();
  }
}

// Si cambian mesas u horarios mientras el modal está abierto.
function actualizarReservaAbierta() {
  const r = estado.reserva;
  if (!r || r.confirmada) return;
  const mesa = estado.mesas.find((m) => m.id === r.mesa.id);
  if (!mesa) {
    mostrarError('Esta mesa ya no está disponible. Elige otra, por favor.');
    ui.botonConfirmar.disabled = true;
    return;
  }
  r.mesa = mesa;
  r.fechas = fechasDisponibles(estado.horarios, hoyISO(), horaActual());
  if (r.fecha && !r.fechas.includes(r.fecha)) {
    r.fecha = null;
    r.slot = null;
  }
  pintarCalendario();
  if (r.fecha) pintarSlots();
  pintarResumen();
}

// ---------------------------------------------------------------------
// Calendario (RF-03)
// ---------------------------------------------------------------------
const DIAS_CABECERA = [['L', 'Lunes'], ['M', 'Martes'], ['M', 'Miércoles'], ['J', 'Jueves'], ['V', 'Viernes'], ['S', 'Sábado'], ['D', 'Domingo']];

function pintarCalendario() {
  const r = estado.reserva;
  const { anio, mes } = r.mes;
  const hoy = hoyISO();
  const ultima = sumarDias(hoy, DIAS_PARA_RESERVAR);
  const disponibles = new Set(r.fechas);
  const mesActual = anio * 12 + mes;
  const [aHoy, mHoy] = hoy.split('-').map(Number);
  const [aFin, mFin] = ultima.split('-').map(Number);

  const celdas = construirMes(anio, mes).flat().map((fecha) => {
    if (!fecha) return '<span></span>';
    const libre = disponibles.has(fecha);
    return `<button type="button" class="calendario__dia${fecha === hoy ? ' calendario__dia--hoy' : ''}"
      data-fecha="${fecha}" aria-pressed="${fecha === r.fecha}" ${libre ? '' : 'disabled'}
      aria-label="${fechaLarga(fecha)}${libre ? '' : ', sin horario'}">${Number(fecha.slice(8))}</button>`;
  }).join('');

  ui.calendario.innerHTML = `
    <div class="calendario__cabecera">
      <button type="button" class="calendario__flecha" data-mes="-1" aria-label="Mes anterior" ${mesActual <= aHoy * 12 + mHoy - 1 ? 'disabled' : ''}>&lsaquo;</button>
      <span class="calendario__mes" aria-live="polite">${nombreMes(mes)} ${anio}</span>
      <button type="button" class="calendario__flecha" data-mes="1" aria-label="Mes siguiente" ${mesActual >= aFin * 12 + mFin - 1 ? 'disabled' : ''}>&rsaquo;</button>
    </div>
    <div class="calendario__grilla">
      ${DIAS_CABECERA.map(([corto, largo]) => `<abbr class="calendario__dia-semana" title="${largo}">${corto}</abbr>`).join('')}
      ${celdas}
    </div>`;
}

ui.calendario.addEventListener('click', (evento) => {
  const r = estado.reserva;
  const flecha = evento.target.closest('[data-mes]');
  if (flecha) {
    const total = r.mes.anio * 12 + r.mes.mes + Number(flecha.dataset.mes);
    r.mes = { anio: Math.floor(total / 12), mes: total % 12 };
    pintarCalendario();
    ui.calendario.querySelector(`[data-mes="${flecha.dataset.mes}"]`)?.focus();
    return;
  }
  const dia = evento.target.closest('[data-fecha]');
  if (dia && !dia.disabled) {
    seleccionarFecha(dia.dataset.fecha);
    ui.calendario.querySelector(`[data-fecha="${dia.dataset.fecha}"]`)?.focus();
  }
});

async function seleccionarFecha(fecha) {
  const r = estado.reserva;
  r.fecha = fecha;
  r.slot = null;
  const [anio, mes] = fecha.split('-').map(Number);
  r.mes = { anio, mes: mes - 1 };
  pintarCalendario();
  pintarResumen();
  ocultarError();
  ui.slots.innerHTML = '<p class="vacio">Buscando horarios…</p>';
  await refrescarOcupados();
}

// ---------------------------------------------------------------------
// Slots de hora (RF-04)
// ---------------------------------------------------------------------
async function refrescarOcupados() {
  const r = estado.reserva;
  if (!r || !r.fecha || r.confirmada) return;
  const fecha = r.fecha;
  try {
    const ocupados = await obtenerOcupados(fecha);
    if (estado.reserva !== r || r.fecha !== fecha) return; // el cliente cambió de día mientras tanto
    r.ocupados = ocupados.filter((o) => o.mesa_id === r.mesa.id);
    pintarSlots();
  } catch (error) {
    ui.slots.innerHTML = `<p class="aviso aviso--error">${escaparHTML(mensajeError(error))}</p>`;
  }
}

function slotsDelDia() {
  const r = estado.reserva;
  const slots = generarSlots(estado.horarios, diaSemana(r.fecha));
  return marcarSlots(slots, r.ocupados, { esHoy: r.fecha === hoyISO(), ahora: horaActual() });
}

const TEXTO_SLOT = { libre: 'libre', ocupado: 'ocupado', pasado: 'ya pasó' };

function pintarSlots() {
  const r = estado.reserva;
  const slots = slotsDelDia();

  // Si el horario elegido ya no está libre, se quita la selección.
  if (r.slot && !slots.some((s) => s.inicio === r.slot.inicio && s.estado === 'libre')) {
    r.slot = null;
    mostrarError('El horario que elegiste ya no está disponible. Elige otro, por favor.');
    pintarResumen();
  }

  if (!slots.length) {
    ui.slots.innerHTML = '<p class="vacio">Este día no hay horarios.</p>';
    return;
  }
  ui.slots.innerHTML = slots.map((s) => `
    <button type="button" class="slot slot--${s.estado}" data-hora="${s.inicio}"
      aria-pressed="${r.slot?.inicio === s.inicio}" ${s.estado === 'libre' ? '' : 'aria-disabled="true"'}
      aria-label="${s.inicio} a ${s.fin}, ${TEXTO_SLOT[s.estado]}">${s.inicio}</button>`).join('');
}

ui.slots.addEventListener('click', (evento) => {
  const boton = evento.target.closest('[data-hora]');
  if (!boton) return;
  const r = estado.reserva;
  const slot = slotsDelDia().find((s) => s.inicio === boton.dataset.hora);
  if (!slot) return;

  // Flujo alternativo del CU-02: si el slot está ocupado, se avisa y se pide otro.
  if (slot.estado !== 'libre') {
    mostrarError(slot.estado === 'ocupado'
      ? 'Ese horario ya está ocupado. Elige otro, por favor.'
      : 'Esa hora ya pasó. Elige otra, por favor.');
    return;
  }
  ocultarError();
  r.slot = { inicio: slot.inicio, fin: slot.fin };
  pintarSlots();
  pintarResumen();
  ui.slots.querySelector(`[data-hora="${slot.inicio}"]`)?.focus();
});

// ---------------------------------------------------------------------
// Resumen y formulario (RF-05)
// ---------------------------------------------------------------------
function pintarResumen() {
  const r = estado.reserva;
  const duracion = r.slot ? aMinutos(r.slot.fin) - aMinutos(r.slot.inicio) : null;
  ui.resumen.innerHTML = `
    <p class="resumen__titulo">Resumen</p>
    <dl>
      <dt>Mesa</dt><dd>${escaparHTML(r.mesa.nombre)}, ${nombreZona(r.mesa.zona)}</dd>
      <dt>Fecha</dt><dd>${r.fecha ? fechaCorta(r.fecha) : 'Elige una fecha'}</dd>
      <dt>Hora</dt><dd>${r.slot ? `${r.slot.inicio} a ${r.slot.fin}` : 'Elige una hora'}</dd>
      ${duracion ? `<dt>Duración</dt><dd>${duracion} minutos</dd>` : ''}
    </dl>`;
}

function mostrarErroresCampos(errores) {
  ['nombre', 'contacto', 'personas'].forEach((campo) => {
    const input = ui.form[campo];
    const mensaje = errores[campo] || '';
    document.getElementById(`error-${campo}`).textContent = mensaje;
    if (mensaje) {
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', `error-${campo}`);
    } else {
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
    }
  });
}

function mostrarError(mensaje) {
  ui.errorReserva.textContent = mensaje;
  ui.errorReserva.hidden = false;
}

function ocultarError() {
  ui.errorReserva.hidden = true;
  ui.errorReserva.textContent = '';
}

ui.form.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const r = estado.reserva;
  ocultarError();

  const datos = {
    nombre: ui.form.nombre.value.trim(),
    personas: ui.form.personas.value,
    contacto: ui.form.contacto.value.trim(),
  };
  const { valido, errores } = validarReserva(datos, r.mesa.capacidad);
  mostrarErroresCampos(errores);

  if (!r.fecha || !r.slot) {
    mostrarError('Elige una fecha y una hora para tu reserva.');
    return;
  }
  if (!valido) {
    ui.form.querySelector('[aria-invalid="true"]')?.focus();
    return;
  }

  ui.botonConfirmar.disabled = true;
  ui.botonConfirmar.textContent = 'Confirmando…';
  try {
    // Paso 10 del flujo: revisar que el slot siga libre justo antes de guardar.
    const ocupados = (await obtenerOcupados(r.fecha)).filter((o) => o.mesa_id === r.mesa.id);
    if (ocupados.some((o) => seCruzan(r.slot, { inicio: o.hora_inicio, fin: o.hora_fin }))) {
      r.ocupados = ocupados;
      throw new Error('SLOT_OCUPADO');
    }
    // La base de datos vuelve a revisar todo y evita la doble reserva aunque dos
    // personas confirmen en el mismo instante.
    const reserva = await crearReserva({
      mesaId: r.mesa.id, fecha: r.fecha, hora: r.slot.inicio,
      nombre: datos.nombre, personas: datos.personas, contacto: datos.contacto,
    });
    mostrarConfirmacion(reserva);
  } catch (error) {
    // Los errores conocidos (como SLOT_OCUPADO) se muestran en pantalla; los demás también van a la consola.
    if (!/^[A-Z_]+$/.test(error?.message || '')) console.error(error);
    const mensaje = mensajeError(error);
    if (/SLOT_OCUPADO|reservas_sin_cruce|HORARIO_INVALIDO|FECHA_INVALIDA/.test(error?.message || '')) {
      r.slot = null;
      pintarResumen();
      await refrescarOcupados();
    }
    mostrarError(mensaje);
  } finally {
    ui.botonConfirmar.disabled = false;
    ui.botonConfirmar.textContent = 'Confirmar reserva';
  }
});

// ---------------------------------------------------------------------
// Confirmación (RF-06)
// ---------------------------------------------------------------------
function mostrarConfirmacion(reserva) {
  estado.reserva.confirmada = true;
  clearInterval(temporizadorSlots);
  ui.titulo.textContent = 'Confirmación';
  ui.subtitulo.textContent = '';
  ui.confirmacionDatos.innerHTML = `
    <dt>Reserva</dt><dd>N.º ${reserva.id}</dd>
    <dt>Nombre</dt><dd>${escaparHTML(reserva.cliente_nombre)}</dd>
    <dt>Mesa</dt><dd>${escaparHTML(reserva.mesa_nombre)} (${nombreZona(reserva.zona)})</dd>
    <dt>Fecha</dt><dd>${fechaCorta(reserva.fecha)}</dd>
    <dt>Hora</dt><dd>${reserva.hora_inicio} a ${reserva.hora_fin}</dd>
    <dt>Personas</dt><dd>${reserva.num_personas}</dd>`;
  ui.form.hidden = true;
  ui.confirmacion.hidden = false;
  ui.confirmacion.focus();
}

// ---------------------------------------------------------------------
// Carta digital (RF-07)
// ---------------------------------------------------------------------
function pintarCarta() {
  const grupos = agruparPlatos(estado.platos);
  if (!grupos.length) {
    ui.pestanas.innerHTML = '';
    ui.carta.innerHTML = '<p class="vacio">La carta se está actualizando. Vuelve en un momento.</p>';
    return;
  }
  if (!grupos.some((g) => g.categoria === estado.categoria)) estado.categoria = grupos[0].categoria;

  ui.pestanas.innerHTML = grupos.map((g) => `
    <button type="button" class="pestana" role="tab" id="pestana-${g.categoria}" data-categoria="${g.categoria}"
      aria-controls="carta-lista" aria-selected="${g.categoria === estado.categoria}"
      tabindex="${g.categoria === estado.categoria ? '0' : '-1'}">${g.titulo}</button>`).join('');

  const grupo = grupos.find((g) => g.categoria === estado.categoria);
  ui.carta.setAttribute('aria-labelledby', `pestana-${grupo.categoria}`);
  ui.carta.innerHTML = grupo.platos.map((p) => `
    <article class="plato">
      <h3 class="plato__nombre">${escaparHTML(p.nombre)}</h3>
      <p class="plato__precio">${formatoPrecio(p.precio)}</p>
      ${p.descripcion ? `<p class="plato__descripcion">${escaparHTML(p.descripcion)}</p>` : ''}
    </article>`).join('');
}

ui.pestanas.addEventListener('click', (evento) => {
  const pestana = evento.target.closest('[data-categoria]');
  if (!pestana) return;
  estado.categoria = pestana.dataset.categoria;
  pintarCarta();
  ui.pestanas.querySelector(`[data-categoria="${estado.categoria}"]`)?.focus();
});

// Flechas izquierda / derecha para moverse entre pestañas con el teclado.
ui.pestanas.addEventListener('keydown', (evento) => {
  if (!['ArrowLeft', 'ArrowRight'].includes(evento.key)) return;
  const pestanas = [...ui.pestanas.querySelectorAll('[data-categoria]')];
  const actual = pestanas.findIndex((p) => p.dataset.categoria === estado.categoria);
  const siguiente = pestanas[(actual + (evento.key === 'ArrowRight' ? 1 : -1) + pestanas.length) % pestanas.length];
  siguiente?.click();
});

// ---------------------------------------------------------------------
// Inicio
// ---------------------------------------------------------------------
if (faltaConfiguracion) {
  const aviso = `<p class="aviso aviso--info">${AVISO_CONFIG}</p>`;
  ui.listaMesas.innerHTML = aviso;
  ui.carta.innerHTML = aviso;
} else {
  cargarTodo();
  // Tiempo real: si el admin cambia mesas, horarios o la carta, la página se actualiza sola.
  escucharCambios(['mesas', 'horarios', 'platos'], conPausa(cargarTodo, 400));
}
