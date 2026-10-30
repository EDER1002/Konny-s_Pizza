// =====================================================================
// supabase.js — Conexión con Supabase y todas las consultas de la app.
// cliente.js y admin.js solo hablan con la base de datos desde aquí.
// =====================================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { ordenarMesas } from './logica.js';

// js/config.js lo crea Vercel en cada despliegue (o tú, copiando config.example.js).
let config = null;
try {
  config = await import('./config.js');
} catch {
  console.error('No se encontró js/config.js. Copia js/config.example.js como js/config.js y pon tus claves.');
}

export const faltaConfiguracion = !config?.SUPABASE_URL || !config?.SUPABASE_ANON_KEY;

export const supabase = faltaConfiguracion ? null : createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);

// Si Supabase responde con error, lo lanza para que la pantalla lo muestre.
function revisar({ data, error }) {
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------
// Módulo cliente
// ---------------------------------------------------------------------

export async function obtenerMesas({ soloActivas = false } = {}) {
  let consulta = supabase.from('mesas').select('id, nombre, zona, capacidad, activa, foto_url, creado_en');
  if (soloActivas) consulta = consulta.eq('activa', true);
  return ordenarMesas(revisar(await consulta));
}

export async function obtenerHorarios() {
  return revisar(await supabase.from('horarios').select('*').order('id'));
}

// Slots ocupados de un día: [{ mesa_id, hora_inicio, hora_fin }]. No trae datos personales.
export async function obtenerOcupados(fecha) {
  return revisar(await supabase.rpc('obtener_ocupados', { p_fecha: fecha }));
}

// La base de datos revisa todo (capacidad, horario, doble reserva) en un solo paso.
export async function crearReserva({ mesaId, fecha, hora, nombre, personas, contacto }) {
  return revisar(await supabase.rpc('crear_reserva', {
    p_mesa_id: mesaId,
    p_fecha: fecha,
    p_hora_inicio: hora,
    p_cliente_nombre: nombre,
    p_num_personas: Number(personas),
    p_cliente_contacto: contacto || null,
  }));
}

export async function obtenerPlatos({ soloDisponibles = false } = {}) {
  let consulta = supabase.from('platos').select('*').order('categoria').order('nombre');
  if (soloDisponibles) consulta = consulta.eq('disponible', true);
  return revisar(await consulta);
}

// Avisa cuando algo cambia en las tablas indicadas (tiempo real de Supabase).
// Devuelve una función para dejar de escuchar.
export function escucharCambios(tablas, alCambiar) {
  const canal = supabase.channel(`cambios-${tablas.join('-')}-${Date.now()}`);
  tablas.forEach((tabla) => {
    canal.on('postgres_changes', { event: '*', schema: 'public', table: tabla }, alCambiar);
  });
  canal.subscribe();
  return () => supabase.removeChannel(canal);
}

// ---------------------------------------------------------------------
// Módulo administrador
// ---------------------------------------------------------------------

async function esAdmin() {
  return revisar(await supabase.rpc('es_admin')) === true;
}

export async function iniciarSesion(email, password) {
  revisar(await supabase.auth.signInWithPassword({ email: email.trim(), password }));
  if (!(await esAdmin())) {
    await supabase.auth.signOut();
    throw new Error('NO_ES_ADMIN');
  }
}

export async function cerrarSesion() {
  await supabase.auth.signOut();
}

// ¿Hay una sesión abierta de un administrador? (para no pedir la clave al recargar)
export async function haySesionAdmin() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) return false;
  try {
    return await esAdmin();
  } catch {
    return false;
  }
}

export async function guardarMesa({ id, nombre, zona, capacidad, foto_url, activa = true }) {
  const datos = { nombre: nombre.trim(), zona, capacidad: Number(capacidad), foto_url: foto_url?.trim() || null, activa };
  const consulta = id
    ? supabase.from('mesas').update(datos).eq('id', id)
    : supabase.from('mesas').insert(datos);
  return revisar(await consulta);
}

export async function borrarMesa(id) {
  return revisar(await supabase.from('mesas').delete().eq('id', id));
}

export async function cambiarEstadoMesa(id, activa) {
  return revisar(await supabase.from('mesas').update({ activa }).eq('id', id));
}

export async function guardarHorario({ id, hora_inicio, hora_fin, duracion_slot, activo }) {
  return revisar(await supabase.from('horarios')
    .update({ hora_inicio, hora_fin, duracion_slot: Number(duracion_slot), activo })
    .eq('id', id));
}

// Reservas con el nombre de su mesa. Filtros opcionales por fecha y mesa.
export async function obtenerReservas({ fecha = '', mesaId = '' } = {}) {
  let consulta = supabase.from('reservas')
    .select('id, mesa_id, cliente_nombre, cliente_contacto, num_personas, fecha, hora_inicio, hora_fin, estado, creado_en, mesas(nombre)')
    .order('fecha', { ascending: false })
    .order('hora_inicio');
  if (fecha) consulta = consulta.eq('fecha', fecha);
  if (mesaId) consulta = consulta.eq('mesa_id', mesaId);
  return revisar(await consulta);
}

export async function cambiarEstadoReserva(id, estado) {
  return revisar(await supabase.from('reservas').update({ estado }).eq('id', id));
}

export async function guardarPlato({ id, nombre, categoria, descripcion, precio, disponible = true }) {
  const datos = { nombre: nombre.trim(), categoria, descripcion: descripcion?.trim() || null, precio: Number(precio), disponible };
  const consulta = id
    ? supabase.from('platos').update(datos).eq('id', id)
    : supabase.from('platos').insert(datos);
  return revisar(await consulta);
}

export async function borrarPlato(id) {
  return revisar(await supabase.from('platos').delete().eq('id', id));
}

export async function cambiarDisponibilidadPlato(id, disponible) {
  return revisar(await supabase.from('platos').update({ disponible }).eq('id', id));
}
