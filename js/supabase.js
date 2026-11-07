// =====================================================================
// supabase.js — Conexión con Supabase y todas las consultas de la app.
// cliente.js y admin.js solo hablan con la base de datos desde aquí.
// =====================================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';
import { ordenarMesas } from './logica.js';

// js/config.js lo crea Vercel en cada despliegue (o tú, copiando config.example.js).
let config = null;
try {
  config = await import('./config.js');
} catch {
  console.error('No se encontró js/config.js. Copia js/config.example.js como js/config.js y pon tus claves.');
}

export const faltaConfiguracion = !config?.SUPABASE_URL || !config?.SUPABASE_ANON_KEY;

// La sesión administrativa vive solo en memoria, sin persistencia en el navegador.
// Al recargar la página se debe volver a ingresar.
export const OPCIONES_AUTH = Object.freeze({
  autoRefreshToken: true,
  persistSession: false,
  detectSessionInUrl: false,
});

export const supabase = faltaConfiguracion
  ? null
  : createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, { auth: OPCIONES_AUTH });

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

async function sesionAdminActiva() {
  return revisar(await supabase.rpc('sesion_admin_activa')) === true;
}

async function exigirSesionAdmin() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session) throw new Error('SESION_ADMIN_EXPIRADA');
  try {
    // Una operación administrativa también cuenta como actividad válida.
    // La función no permite renovar un registro que ya superó los cinco minutos.
    await registrarActividadAdmin();
  } catch (errorActividad) {
    const texto = `${errorActividad?.message || ''} ${errorActividad?.code || ''}`;
    const sesionRechazada = texto.includes('SESION_ADMIN_EXPIRADA')
      || texto.includes('NO_ES_ADMIN')
      || texto.includes('JWT expired')
      || errorActividad?.code === '42501';
    if (!sesionRechazada) throw errorActividad;
    try { await cerrarSesion(); } catch { /* RLS mantiene el bloqueo en PostgreSQL. */ }
    throw new Error('SESION_ADMIN_EXPIRADA', { cause: errorActividad });
  }
}

export async function registrarActividadAdmin() {
  return revisar(await supabase.rpc('registrar_actividad_admin')) === true;
}

export async function iniciarSesion(email, password) {
  revisar(await supabase.auth.signInWithPassword({ email: email.trim(), password }));
  if (!(await esAdmin())) {
    await supabase.auth.signOut({ scope: 'local' });
    throw new Error('NO_ES_ADMIN');
  }
  try {
    // Crea el registro asociado al session_id firmado por Supabase Auth.
    await registrarActividadAdmin();
  } catch (error) {
    await supabase.auth.signOut({ scope: 'local' });
    throw error;
  }
}

export async function cerrarSesion() {
  if (!supabase) return;
  // Borra el registro de actividad y revoca la sesión actual en Supabase Auth.
  // Si el registro ya expiró o no hay red, signOut sigue siendo el intento final.
  try { await supabase.rpc('cerrar_sesion_admin'); } catch { /* cierre local a continuación */ }
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) throw error;
}

// Sin persistencia no se conserva sesión al recargar. Esta verificación cubre
// también el caso de una sesión que haya vencido en PostgreSQL.
export async function haySesionAdmin() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) return false;
  try {
    return await sesionAdminActiva();
  } catch {
    return false;
  }
}

export async function guardarMesa({ id, nombre, zona, capacidad, foto_url, activa = true }) {
  await exigirSesionAdmin();
  const datos = { nombre: nombre.trim(), zona, capacidad: Number(capacidad), foto_url: foto_url?.trim() || null, activa };
  const consulta = id
    ? supabase.from('mesas').update(datos).eq('id', id)
    : supabase.from('mesas').insert(datos);
  return revisar(await consulta);
}

export async function borrarMesa(id) {
  await exigirSesionAdmin();
  return revisar(await supabase.from('mesas').delete().eq('id', id));
}

export async function cambiarEstadoMesa(id, activa) {
  await exigirSesionAdmin();
  return revisar(await supabase.from('mesas').update({ activa }).eq('id', id));
}

export async function guardarHorario({ id, hora_inicio, hora_fin, duracion_slot, activo }) {
  await exigirSesionAdmin();
  return revisar(await supabase.from('horarios')
    .update({ hora_inicio, hora_fin, duracion_slot: Number(duracion_slot), activo })
    .eq('id', id));
}

// Reservas con el nombre de su mesa. Filtros opcionales por fecha y mesa.
export async function obtenerReservas({ fecha = '', mesaId = '' } = {}) {
  await exigirSesionAdmin();
  let consulta = supabase.from('reservas')
    .select('id, mesa_id, cliente_nombre, cliente_contacto, num_personas, fecha, hora_inicio, hora_fin, estado, creado_en, mesas(nombre)')
    .order('fecha', { ascending: false })
    .order('hora_inicio');
  if (fecha) consulta = consulta.eq('fecha', fecha);
  if (mesaId) consulta = consulta.eq('mesa_id', mesaId);
  return revisar(await consulta);
}

// Datos mínimos para Recomendaciones. Pagina para no truncar silenciosamente
// el análisis en el límite máximo de filas configurado en Supabase.
export async function obtenerReservasAnalisis() {
  await exigirSesionAdmin();
  const tamanoPagina = 500;
  const filas = [];
  for (let desde = 0; ; desde += tamanoPagina) {
    const pagina = revisar(await supabase.from('reservas')
      .select('mesa_id, num_personas, fecha, hora_inicio, estado')
      .order('id', { ascending: true })
      .range(desde, desde + tamanoPagina - 1));
    filas.push(...pagina);
    if (pagina.length < tamanoPagina) break;
  }
  return filas;
}

export async function cambiarEstadoReserva(id, estado) {
  await exigirSesionAdmin();
  return revisar(await supabase.from('reservas').update({ estado }).eq('id', id));
}

export async function guardarPlato({ id, nombre, categoria, descripcion, precio, disponible = true }) {
  await exigirSesionAdmin();
  const datos = { nombre: nombre.trim(), categoria, descripcion: descripcion?.trim() || null, precio: Number(precio), disponible };
  const consulta = id
    ? supabase.from('platos').update(datos).eq('id', id)
    : supabase.from('platos').insert(datos);
  return revisar(await consulta);
}

export async function borrarPlato(id) {
  await exigirSesionAdmin();
  return revisar(await supabase.from('platos').delete().eq('id', id));
}

export async function cambiarDisponibilidadPlato(id, disponible) {
  await exigirSesionAdmin();
  return revisar(await supabase.from('platos').update({ disponible }).eq('id', id));
}
