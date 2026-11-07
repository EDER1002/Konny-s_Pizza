// Controla la inactividad de una sesión administrativa sin persistir estado.
export const TIEMPO_INACTIVIDAD_ADMIN_MS = 5 * 60 * 1000;
export const EVENTOS_ACTIVIDAD_ADMIN = Object.freeze([
  'mousemove', 'keydown', 'click', 'scroll', 'touchstart',
]);

export function crearControlInactividad({
  destino,
  ventana,
  alExpirar,
  alRegistrarActividad = () => {},
  ahora = () => Date.now(),
  programar = setTimeout,
  cancelar = clearTimeout,
  tiempoInactividad = TIEMPO_INACTIVIDAD_ADMIN_MS,
}) {
  if (!destino || !ventana || typeof alExpirar !== 'function') {
    throw new TypeError('Faltan los elementos necesarios para controlar la inactividad.');
  }

  let activo = false;
  let suspendido = false;
  let ultimaActividad = 0;
  let temporizador = null;

  function limpiarTemporizador() {
    if (temporizador !== null) cancelar(temporizador);
    temporizador = null;
  }

  function agregarEventosActividad() {
    EVENTOS_ACTIVIDAD_ADMIN.forEach((evento) => destino.addEventListener(evento, manejarActividad, { passive: true, capture: true }));
    destino.addEventListener('visibilitychange', revisarVencimientoAlVolver);
  }

  function quitarEventosActividad() {
    EVENTOS_ACTIVIDAD_ADMIN.forEach((evento) => destino.removeEventListener(evento, manejarActividad, true));
    destino.removeEventListener('visibilitychange', revisarVencimientoAlVolver);
  }

  function detener() {
    activo = false;
    suspendido = false;
    limpiarTemporizador();
    quitarEventosActividad();
    ventana.removeEventListener('pagehide', suspender);
    ventana.removeEventListener('pageshow', reanudar);
  }

  function expirar() {
    if (!activo && !suspendido) return;
    detener();
    Promise.resolve().then(() => alExpirar()).catch((error) => {
      console.error('No se pudo completar el cierre por inactividad:', error);
    });
  }

  function programarVencimiento() {
    limpiarTemporizador();
    const restante = Math.max(0, tiempoInactividad - (ahora() - ultimaActividad));
    temporizador = programar(comprobarVencimiento, restante);
  }

  function comprobarVencimiento() {
    if (!activo) return;
    if (ahora() - ultimaActividad >= tiempoInactividad) {
      expirar();
      return;
    }
    programarVencimiento();
  }

  function manejarActividad() {
    if (!activo) return;
    if (ahora() - ultimaActividad >= tiempoInactividad) {
      comprobarVencimiento();
      return;
    }
    ultimaActividad = ahora();
    programarVencimiento();
    alRegistrarActividad(ultimaActividad);
  }

  function revisarVencimientoAlVolver() {
    if (ventana.document?.visibilityState === 'hidden') return;
    comprobarVencimiento();
  }

  // Si la página entra en bfcache, suspende listeners y timers. pageshow
  // reanuda solo si el plazo no venció; nunca reinicia el tiempo al regresar.
  function suspender() {
    if (!activo) return;
    activo = false;
    suspendido = true;
    limpiarTemporizador();
    quitarEventosActividad();
  }

  function reanudar() {
    if (!suspendido) return;
    if (ahora() - ultimaActividad >= tiempoInactividad) {
      expirar();
      return;
    }
    suspendido = false;
    activo = true;
    agregarEventosActividad();
    programarVencimiento();
  }

  function iniciar() {
    if (activo) return;
    if (suspendido) {
      reanudar();
      return;
    }
    activo = true;
    ultimaActividad = ahora();
    agregarEventosActividad();
    ventana.addEventListener('pagehide', suspender);
    ventana.addEventListener('pageshow', reanudar);
    programarVencimiento();
  }

  return {
    iniciar,
    detener,
    get activo() { return activo; },
    get suspendido() { return suspendido; },
    get ultimaActividad() { return ultimaActividad; },
  };
}
