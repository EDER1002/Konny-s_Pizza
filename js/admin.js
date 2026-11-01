// =====================================================================
// admin.js — Panel de administración (/admin): acceso (RF-08), mesas
// (RF-09, RF-10, RF-13), horarios (RF-11), reservas (RF-12) y carta (RF-14).
// =====================================================================
import {
  faltaConfiguracion, iniciarSesion, cerrarSesion, haySesionAdmin,
  obtenerMesas, guardarMesa, borrarMesa, cambiarEstadoMesa,
  obtenerHorarios, guardarHorario,
  obtenerReservas, cambiarEstadoReserva,
  obtenerPlatos, guardarPlato, borrarPlato, cambiarDisponibilidadPlato,
  escucharCambios,
} from './supabase.js';
import {
  mensajeError, escaparHTML, nombreZona, nombreDia, ORDEN_DIAS, CATEGORIAS,
  formatoPrecio, paginar, fechaCorta, aMinutos, MENSAJE_GENERICO,
} from './logica.js';
import { abrirModal, cerrarModal, mostrarToast, conPausa, AVISO_CONFIG } from './ui.js';

const $ = (selector) => document.querySelector(selector);
const POR_PAGINA = 10;
const VISTAS = ['mesas', 'horarios', 'reservas', 'carta'];
const ESTADOS_RESERVA = [
  ['confirmada', 'Confirmada'],
  ['cancelada', 'Cancelada'],
  ['completada', 'Completada'],
];

const estado = {
  vista: 'mesas',
  mesas: [],
  horarios: [],
  reservas: [],
  platos: [],
  pagina: 1,
  filtros: { fecha: '', mesaId: '' },
  dejarDeEscuchar: null,
};

const ui = {
  acceso: $('#acceso'),
  formAcceso: $('#form-acceso'),
  errorAcceso: $('#acceso-error'),
  botonAcceso: $('#acceso-boton'),
  panel: $('#panel'),
  menu: $('.panel__menu'),
  contenido: $('#contenido'),
  tablaMesas: $('#tabla-mesas'),
  tablaHorarios: $('#tabla-horarios'),
  tablaReservas: $('#tabla-reservas'),
  tablaPlatos: $('#tabla-platos'),
  paginacion: $('#paginacion'),
  formFiltros: $('#form-filtros'),
  filtroMesa: $('#filtro-mesa'),
  modalMesa: $('#modal-mesa'),
  formMesa: $('#form-mesa'),
  modalPlato: $('#modal-plato'),
  formPlato: $('#form-plato'),
};

// Ejecuta una acción y muestra el error en un aviso si algo falla.
async function intentar(accion, { exito } = {}) {
  try {
    const resultado = await accion();
    if (exito) mostrarToast(exito);
    return resultado;
  } catch (error) {
    const mensaje = mensajeError(error);
    if (mensaje === MENSAJE_GENERICO) console.error(error); // solo los errores que no conocemos
    mostrarToast(mensaje, 'error');
    return undefined;
  }
}

function filaVacia(columnas, texto) {
  return `<tr><td class="vacio" colspan="${columnas}">${texto}</td></tr>`;
}

// ---------------------------------------------------------------------
// Acceso (RF-08)
// ---------------------------------------------------------------------
function mostrarAcceso() {
  ui.panel.hidden = true;
  ui.acceso.hidden = false;
  ui.formAcceso.reset();
  $('#acceso-correo').focus();
}

ui.formAcceso.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const correo = ui.formAcceso.correo.value.trim();
  const clave = ui.formAcceso.clave.value;
  ui.errorAcceso.hidden = true;
  if (!correo || !clave) {
    ui.errorAcceso.textContent = 'Escribe el correo y la contraseña.';
    ui.errorAcceso.hidden = false;
    return;
  }
  ui.botonAcceso.disabled = true;
  ui.botonAcceso.textContent = 'Ingresando…';
  try {
    await iniciarSesion(correo, clave);
    await mostrarPanel();
  } catch (error) {
    ui.errorAcceso.textContent = mensajeError(error);
    ui.errorAcceso.hidden = false;
  } finally {
    ui.botonAcceso.disabled = false;
    ui.botonAcceso.textContent = 'Ingresar';
  }
});

$('#boton-salir').addEventListener('click', async () => {
  estado.dejarDeEscuchar?.();
  estado.dejarDeEscuchar = null;
  await cerrarSesion();
  mostrarAcceso();
});

// ---------------------------------------------------------------------
// Panel y navegación entre secciones
// ---------------------------------------------------------------------
async function mostrarPanel() {
  ui.acceso.hidden = true;
  ui.panel.hidden = false;
  await cargarMesas(); // las mesas también se usan en el filtro de reservas
  const inicial = location.hash.slice(1);
  await cambiarVista(VISTAS.includes(inicial) ? inicial : 'mesas');

  // Tiempo real: las reservas nuevas aparecen sin recargar.
  estado.dejarDeEscuchar?.();
  estado.dejarDeEscuchar = escucharCambios(['reservas'], conPausa(() => {
    if (estado.vista === 'reservas') cargarReservas();
  }, 500));
}

async function cambiarVista(vista) {
  estado.vista = vista;
  VISTAS.forEach((v) => { $(`#vista-${v}`).hidden = v !== vista; });
  ui.menu.querySelectorAll('[data-vista]').forEach((b) => {
    if (b.dataset.vista === vista) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  history.replaceState(null, '', `#${vista}`);
  const cargas = { mesas: cargarMesas, horarios: cargarHorarios, reservas: cargarReservas, carta: cargarPlatos };
  await cargas[vista]();
}

ui.menu.addEventListener('click', (evento) => {
  const boton = evento.target.closest('[data-vista]');
  if (boton) cambiarVista(boton.dataset.vista);
});

// ---------------------------------------------------------------------
// Mesas (RF-09, RF-10, RF-13)
// ---------------------------------------------------------------------
async function cargarMesas() {
  const mesas = await intentar(() => obtenerMesas());
  if (!mesas) return;
  estado.mesas = mesas;
  pintarMesas();
  pintarFiltroMesas();
}

function pintarMesas() {
  if (!estado.mesas.length) {
    ui.tablaMesas.innerHTML = filaVacia(5, 'Aún no hay mesas. Crea la primera con "Nueva mesa".');
    return;
  }
  ui.tablaMesas.innerHTML = estado.mesas.map((m) => `
    <tr>
      <td><strong>${escaparHTML(m.nombre)}</strong>${m.foto_url ? '<span class="tabla__secundario">Con foto</span>' : ''}</td>
      <td>${nombreZona(m.zona)}</td>
      <td>${m.capacidad} personas</td>
      <td>
        <label class="interruptor">
          <input type="checkbox" data-accion="activar-mesa" data-id="${m.id}" ${m.activa ? 'checked' : ''}
            aria-label="${escaparHTML(m.nombre)} activa">
          <span>${m.activa ? 'Activa' : 'Inactiva'}</span>
        </label>
      </td>
      <td>
        <div class="tabla__acciones">
          <button class="boton boton--borde boton--chico" type="button" data-accion="editar-mesa" data-id="${m.id}">Editar</button>
          <button class="boton boton--peligro boton--chico" type="button" data-accion="borrar-mesa" data-id="${m.id}">Borrar</button>
        </div>
      </td>
    </tr>`).join('');
}

function abrirFormularioMesa(mesa = null) {
  ui.formMesa.reset();
  $('#mesa-error').hidden = true;
  $('#mesa-titulo').textContent = mesa ? `Editar ${mesa.nombre}` : 'Nueva mesa';
  ui.formMesa.id.value = mesa?.id || '';
  ui.formMesa.nombre.value = mesa?.nombre || '';
  ui.formMesa.zona.value = mesa?.zona || 'salon';
  ui.formMesa.capacidad.value = mesa?.capacidad || 4;
  ui.formMesa.foto_url.value = mesa?.foto_url || '';
  abrirModal(ui.modalMesa, { enfocar: ui.formMesa.nombre });
}

ui.formMesa.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const f = ui.formMesa;
  const error = $('#mesa-error');
  const capacidad = Number(f.capacidad.value);
  let problema = '';
  if (!f.nombre.value.trim()) problema = 'Escribe el nombre o número de la mesa.';
  else if (!Number.isInteger(capacidad) || capacidad < 1 || capacidad > 20) problema = 'La capacidad debe estar entre 1 y 20 personas.';
  else if (f.foto_url.value.trim() && !/^https:\/\/[^\s<>"]+$/.test(f.foto_url.value.trim())) problema = 'La foto debe ser un enlace que empiece por https://';
  if (problema) {
    error.textContent = problema;
    error.hidden = false;
    return;
  }
  const actual = estado.mesas.find((m) => m.id === Number(f.id.value));
  try {
    await guardarMesa({
      id: actual?.id, nombre: f.nombre.value, zona: f.zona.value, capacidad,
      foto_url: f.foto_url.value, activa: actual ? actual.activa : true,
    });
    cerrarModal();
    mostrarToast('Mesa guardada.');
    await cargarMesas();
  } catch (e) {
    error.textContent = mensajeError(e);
    error.hidden = false;
  }
});

// ---------------------------------------------------------------------
// Horarios (RF-11)
// ---------------------------------------------------------------------
async function cargarHorarios() {
  const horarios = await intentar(() => obtenerHorarios());
  if (!horarios) return;
  estado.horarios = horarios.sort((a, b) =>
    ORDEN_DIAS.indexOf(a.dia_semana) - ORDEN_DIAS.indexOf(b.dia_semana) || aMinutos(a.hora_inicio) - aMinutos(b.hora_inicio));
  pintarHorarios();
}

function pintarHorarios() {
  if (!estado.horarios.length) {
    ui.tablaHorarios.innerHTML = filaVacia(7, 'No hay horarios. Vuelve a ejecutar la parte 5 de supabase/schema.sql.');
    return;
  }
  ui.tablaHorarios.innerHTML = estado.horarios.map((h) => {
    const etiqueta = `${nombreDia(h.dia_semana)}, ${h.jornada}`;
    return `
    <tr data-id="${h.id}">
      <td>${nombreDia(h.dia_semana)}</td>
      <td>${h.jornada === 'almuerzo' ? 'Almuerzo' : 'Noche'}</td>
      <td><input type="time" name="hora_inicio" value="${h.hora_inicio.slice(0, 5)}" aria-label="Abre (${etiqueta})"></td>
      <td><input type="time" name="hora_fin" value="${h.hora_fin.slice(0, 5)}" aria-label="Cierra (${etiqueta})"></td>
      <td><input type="number" name="duracion_slot" value="${h.duracion_slot}" min="15" max="240" step="15" aria-label="Duración en minutos (${etiqueta})"></td>
      <td><label class="interruptor"><input type="checkbox" name="activo" ${h.activo ? 'checked' : ''} aria-label="Abierto (${etiqueta})"></label></td>
      <td><button class="boton boton--borde boton--chico" type="button" data-accion="guardar-horario">Guardar</button></td>
    </tr>`;
  }).join('');
}

async function guardarFilaHorario(fila) {
  const h = estado.horarios.find((x) => x.id === Number(fila.dataset.id));
  const datos = {
    id: h.id,
    hora_inicio: fila.querySelector('[name="hora_inicio"]').value,
    hora_fin: fila.querySelector('[name="hora_fin"]').value,
    duracion_slot: Number(fila.querySelector('[name="duracion_slot"]').value),
    activo: fila.querySelector('[name="activo"]').checked,
  };
  if (!datos.hora_inicio || !datos.hora_fin || aMinutos(datos.hora_fin) <= aMinutos(datos.hora_inicio)) {
    mostrarToast('La hora de cierre debe ser mayor que la de apertura.', 'error');
    return;
  }
  if (!Number.isInteger(datos.duracion_slot) || datos.duracion_slot < 15 || datos.duracion_slot > 240) {
    mostrarToast('La duración debe estar entre 15 y 240 minutos.', 'error');
    return;
  }
  const ok = await intentar(() => guardarHorario(datos), {
    exito: `Horario del ${nombreDia(h.dia_semana).toLowerCase()} (${h.jornada}) guardado.`,
  });
  if (ok !== undefined) await cargarHorarios();
}

// ---------------------------------------------------------------------
// Reservas (RF-12)
// ---------------------------------------------------------------------
function pintarFiltroMesas() {
  const elegido = ui.filtroMesa.value;
  ui.filtroMesa.innerHTML = '<option value="">Todas</option>' +
    estado.mesas.map((m) => `<option value="${m.id}">${escaparHTML(m.nombre)}</option>`).join('');
  ui.filtroMesa.value = elegido;
}

async function cargarReservas() {
  const reservas = await intentar(() => obtenerReservas(estado.filtros));
  if (!reservas) return;
  estado.reservas = reservas;
  pintarReservas();
}

function pintarReservas() {
  const { items, pagina, totalPaginas, total } = paginar(estado.reservas, estado.pagina, POR_PAGINA);
  estado.pagina = pagina;

  ui.tablaReservas.innerHTML = items.length
    ? items.map((r) => `
      <tr>
        <td class="tabla__texto"><strong>${escaparHTML(r.cliente_nombre)}</strong>
          ${r.cliente_contacto ? `<span class="tabla__secundario">${escaparHTML(r.cliente_contacto)}</span>` : ''}</td>
        <td>${escaparHTML(r.mesas?.nombre || `Mesa ${r.mesa_id}`)}</td>
        <td>${fechaCorta(r.fecha)}</td>
        <td>${r.hora_inicio.slice(0, 5)} a ${r.hora_fin.slice(0, 5)}</td>
        <td>${r.num_personas}</td>
        <td>
          <select data-accion="estado-reserva" data-id="${r.id}" aria-label="Estado de la reserva de ${escaparHTML(r.cliente_nombre)}">
            ${ESTADOS_RESERVA.map(([valor, texto]) => `<option value="${valor}" ${valor === r.estado ? 'selected' : ''}>${texto}</option>`).join('')}
          </select>
        </td>
      </tr>`).join('')
    : filaVacia(6, estado.filtros.fecha || estado.filtros.mesaId
      ? 'No hay reservas con estos filtros.'
      : 'Todavía no hay reservas. Aparecerán aquí apenas un cliente reserve.');

  ui.paginacion.innerHTML = total > 0 ? `
    <span>Mostrando ${items.length} de ${total} reservas</span>
    <div class="paginacion__botones">
      <button class="boton boton--borde boton--chico" type="button" data-pagina="${pagina - 1}" ${pagina <= 1 ? 'disabled' : ''}>Anterior</button>
      <span class="paginacion__pagina" aria-live="polite">Página ${pagina} de ${totalPaginas}</span>
      <button class="boton boton--borde boton--chico" type="button" data-pagina="${pagina + 1}" ${pagina >= totalPaginas ? 'disabled' : ''}>Siguiente</button>
    </div>` : '';
}

ui.formFiltros.addEventListener('submit', (evento) => {
  evento.preventDefault();
  estado.filtros = { fecha: ui.formFiltros.fecha.value, mesaId: ui.formFiltros.mesa.value };
  estado.pagina = 1;
  cargarReservas();
});

ui.paginacion.addEventListener('click', (evento) => {
  const boton = evento.target.closest('[data-pagina]');
  if (!boton || boton.disabled) return;
  estado.pagina = Number(boton.dataset.pagina);
  pintarReservas();
});

// ---------------------------------------------------------------------
// Carta (RF-14)
// ---------------------------------------------------------------------
ui.formPlato.categoria.innerHTML = CATEGORIAS.map((c) => `<option value="${c.id}">${c.titulo}</option>`).join('');

async function cargarPlatos() {
  const platos = await intentar(() => obtenerPlatos());
  if (!platos) return;
  const orden = CATEGORIAS.map((c) => c.id);
  estado.platos = platos.sort((a, b) =>
    orden.indexOf(a.categoria) - orden.indexOf(b.categoria) || a.nombre.localeCompare(b.nombre, 'es'));
  pintarPlatos();
}

function pintarPlatos() {
  if (!estado.platos.length) {
    ui.tablaPlatos.innerHTML = filaVacia(5, 'La carta está vacía. Agrega el primer plato con "Nuevo plato".');
    return;
  }
  const titulo = Object.fromEntries(CATEGORIAS.map((c) => [c.id, c.titulo]));
  ui.tablaPlatos.innerHTML = estado.platos.map((p) => `
    <tr>
      <td class="tabla__texto"><strong>${escaparHTML(p.nombre)}</strong>
        ${p.descripcion ? `<span class="tabla__secundario">${escaparHTML(p.descripcion)}</span>` : ''}</td>
      <td>${titulo[p.categoria] || p.categoria}</td>
      <td>${formatoPrecio(p.precio)}</td>
      <td>
        <label class="interruptor">
          <input type="checkbox" data-accion="mostrar-plato" data-id="${p.id}" ${p.disponible ? 'checked' : ''}
            aria-label="Mostrar ${escaparHTML(p.nombre)} en la carta">
          <span>${p.disponible ? 'Visible' : 'Oculto'}</span>
        </label>
      </td>
      <td>
        <div class="tabla__acciones">
          <button class="boton boton--borde boton--chico" type="button" data-accion="editar-plato" data-id="${p.id}">Editar</button>
          <button class="boton boton--peligro boton--chico" type="button" data-accion="borrar-plato" data-id="${p.id}">Borrar</button>
        </div>
      </td>
    </tr>`).join('');
}

function abrirFormularioPlato(plato = null) {
  ui.formPlato.reset();
  $('#plato-error').hidden = true;
  $('#plato-titulo').textContent = plato ? 'Editar plato' : 'Nuevo plato';
  ui.formPlato.id.value = plato?.id || '';
  ui.formPlato.nombre.value = plato?.nombre || '';
  ui.formPlato.categoria.value = plato?.categoria || 'pizzas';
  ui.formPlato.precio.value = plato?.precio ?? '';
  ui.formPlato.descripcion.value = plato?.descripcion || '';
  ui.formPlato.disponible.checked = plato ? plato.disponible : true;
  abrirModal(ui.modalPlato, { enfocar: ui.formPlato.nombre });
}

ui.formPlato.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const f = ui.formPlato;
  const error = $('#plato-error');
  const precio = Number(f.precio.value);
  let problema = '';
  if (!f.nombre.value.trim()) problema = 'Escribe el nombre del plato.';
  else if (f.precio.value === '' || !Number.isInteger(precio) || precio < 0) problema = 'Escribe el precio en pesos, sin puntos ni comas.';
  if (problema) {
    error.textContent = problema;
    error.hidden = false;
    return;
  }
  try {
    await guardarPlato({
      id: Number(f.id.value) || undefined, nombre: f.nombre.value, categoria: f.categoria.value,
      descripcion: f.descripcion.value, precio, disponible: f.disponible.checked,
    });
    cerrarModal();
    mostrarToast('Plato guardado.');
    await cargarPlatos();
  } catch (e) {
    error.textContent = mensajeError(e);
    error.hidden = false;
  }
});

// ---------------------------------------------------------------------
// Botones y cambios dentro de las tablas
// ---------------------------------------------------------------------
ui.contenido.addEventListener('click', async (evento) => {
  const boton = evento.target.closest('button[data-accion]');
  if (!boton) return;
  const id = Number(boton.dataset.id);
  const accion = boton.dataset.accion;

  if (accion === 'nueva-mesa') abrirFormularioMesa();
  if (accion === 'editar-mesa') abrirFormularioMesa(estado.mesas.find((m) => m.id === id));
  if (accion === 'borrar-mesa') {
    const mesa = estado.mesas.find((m) => m.id === id);
    if (!confirm(`¿Borrar ${mesa.nombre}? Esto no se puede deshacer.`)) return;
    const ok = await intentar(() => borrarMesa(id), { exito: `${mesa.nombre} borrada.` });
    if (ok !== undefined) await cargarMesas();
  }
  if (accion === 'guardar-horario') await guardarFilaHorario(boton.closest('tr'));
  if (accion === 'limpiar-filtros') {
    ui.formFiltros.reset();
    estado.filtros = { fecha: '', mesaId: '' };
    estado.pagina = 1;
    await cargarReservas();
  }
  if (accion === 'nuevo-plato') abrirFormularioPlato();
  if (accion === 'editar-plato') abrirFormularioPlato(estado.platos.find((p) => p.id === id));
  if (accion === 'borrar-plato') {
    const plato = estado.platos.find((p) => p.id === id);
    if (!confirm(`¿Borrar "${plato.nombre}" de la carta? Si solo quieres quitarlo por un tiempo, mejor ocúltalo.`)) return;
    const ok = await intentar(() => borrarPlato(id), { exito: 'Plato borrado.' });
    if (ok !== undefined) await cargarPlatos();
  }
});

ui.contenido.addEventListener('change', async (evento) => {
  const control = evento.target.closest('[data-accion]');
  if (!control) return;
  const id = Number(control.dataset.id);

  if (control.dataset.accion === 'activar-mesa') {
    const mesa = estado.mesas.find((m) => m.id === id);
    const ok = await intentar(() => cambiarEstadoMesa(id, control.checked), {
      exito: `${mesa.nombre} ${control.checked ? 'activada' : 'desactivada'}.`,
    });
    if (ok === undefined) control.checked = !control.checked;
    await cargarMesas();
  }

  if (control.dataset.accion === 'estado-reserva') {
    const reserva = estado.reservas.find((r) => r.id === id);
    const ok = await intentar(() => cambiarEstadoReserva(id, control.value), {
      exito: `Reserva de ${reserva.cliente_nombre}: ${control.value}.`,
    });
    if (ok === undefined) control.value = reserva.estado;
    else reserva.estado = control.value;
  }

  if (control.dataset.accion === 'mostrar-plato') {
    const plato = estado.platos.find((p) => p.id === id);
    const ok = await intentar(() => cambiarDisponibilidadPlato(id, control.checked), {
      exito: `${plato.nombre} ${control.checked ? 'visible' : 'oculto'} en la carta.`,
    });
    if (ok === undefined) control.checked = !control.checked;
    await cargarPlatos();
  }
});

// ---------------------------------------------------------------------
// Inicio
// ---------------------------------------------------------------------
if (faltaConfiguracion) {
  ui.acceso.hidden = false;
  ui.errorAcceso.textContent = AVISO_CONFIG;
  ui.errorAcceso.hidden = false;
  ui.botonAcceso.disabled = true;
} else if (await haySesionAdmin()) {
  await mostrarPanel();
} else {
  mostrarAcceso();
}
