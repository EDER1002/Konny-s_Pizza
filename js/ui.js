// =====================================================================
// ui.js — Ayudas de pantalla que usan cliente.js y admin.js:
// abrir y cerrar ventanas (modales), avisos cortos (toast) y pausas.
// =====================================================================

let ultimoFoco = null;
let modalAbierto = null;
let alCerrarModal = null;

const SELECTOR_ENFOCABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Abre un modal, guarda dónde estaba el foco y bloquea el scroll de fondo.
export function abrirModal(modal, { alCerrar = null, enfocar = null } = {}) {
  ultimoFoco = document.activeElement;
  modalAbierto = modal;
  alCerrarModal = alCerrar;
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  const destino = enfocar || modal.querySelector(SELECTOR_ENFOCABLE);
  destino?.focus();
}

export function cerrarModal() {
  if (!modalAbierto) return;
  modalAbierto.hidden = true;
  modalAbierto = null;
  document.body.style.overflow = '';
  ultimoFoco?.focus?.();
  const callback = alCerrarModal;
  alCerrarModal = null;
  callback?.();
}

// Cierra con Escape o con cualquier elemento marcado data-cerrar,
// y mantiene el foco del teclado dentro del modal.
document.addEventListener('keydown', (evento) => {
  if (!modalAbierto) return;
  if (evento.key === 'Escape') {
    cerrarModal();
    return;
  }
  if (evento.key === 'Tab') {
    const enfocables = [...modalAbierto.querySelectorAll(SELECTOR_ENFOCABLE)].filter((el) => el.offsetParent !== null);
    if (!enfocables.length) return;
    const primero = enfocables[0];
    const ultimo = enfocables[enfocables.length - 1];
    if (evento.shiftKey && document.activeElement === primero) {
      evento.preventDefault();
      ultimo.focus();
    } else if (!evento.shiftKey && document.activeElement === ultimo) {
      evento.preventDefault();
      primero.focus();
    }
  }
});

document.addEventListener('click', (evento) => {
  if (modalAbierto && evento.target.closest('[data-cerrar]') && modalAbierto.contains(evento.target)) {
    cerrarModal();
  }
});

// Aviso corto en la parte de abajo de la pantalla.
let temporizadorToast = null;
export function mostrarToast(mensaje, tipo = 'ok') {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    toast.setAttribute('role', 'status');
    document.body.append(toast);
  }
  toast.textContent = mensaje;
  toast.classList.toggle('toast--error', tipo === 'error');
  toast.hidden = false;
  clearTimeout(temporizadorToast);
  temporizadorToast = setTimeout(() => { toast.hidden = true; }, tipo === 'error' ? 6000 : 3500);
}

// Espera a que pasen "ms" sin llamadas antes de ejecutar (evita recargar muchas veces seguidas).
export function conPausa(funcion, ms = 400) {
  let temporizador = null;
  return (...args) => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => funcion(...args), ms);
  };
}

// Mensaje para cuando falta js/config.js.
export const AVISO_CONFIG = 'Falta conectar la app con Supabase: crea js/config.js (mira el README).';
