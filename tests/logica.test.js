// Pruebas de js/logica.js (funciones que no dependen de la página ni de Supabase).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  aMinutos, aHora, diaSemana, hoyISO, sumarDias, generarSlots, seCruzan, marcarSlots,
  estadoMesaHoy, fechasDisponibles, construirMes, validarReserva, mensajeError,
  formatoPrecio, fechaLarga, fechaCorta, paginar, agruparPlatos, escaparHTML, nombreZona, nombreDia,
  ordenarMesas, cuandoEs, resumenHorario,
} from '../js/logica.js';

// Horario de ejemplo: lunes con las dos jornadas, martes solo noche, miércoles inactivo.
const horarios = [
  { dia_semana: 'lunes', jornada: 'noche', hora_inicio: '17:00:00', hora_fin: '20:00:00', duracion_slot: 60, activo: true },
  { dia_semana: 'lunes', jornada: 'almuerzo', hora_inicio: '12:30:00', hora_fin: '14:30:00', duracion_slot: 60, activo: true },
  { dia_semana: 'martes', jornada: 'noche', hora_inicio: '17:00', hora_fin: '18:30', duracion_slot: 30, activo: true },
  { dia_semana: 'miercoles', jornada: 'almuerzo', hora_inicio: '12:30', hora_fin: '14:30', duracion_slot: 60, activo: false },
];

describe('horas', () => {
  test('aMinutos convierte HH:MM y HH:MM:SS a minutos', () => {
    assert.equal(aMinutos('12:30'), 750);
    assert.equal(aMinutos('23:00:00'), 1380);
    assert.equal(aMinutos('00:05'), 5);
  });
  test('aHora convierte minutos a HH:MM con ceros', () => {
    assert.equal(aHora(750), '12:30');
    assert.equal(aHora(5), '00:05');
    assert.equal(aHora(1380), '23:00');
  });
});

describe('fechas', () => {
  test('diaSemana devuelve el día en español sin tildes', () => {
    assert.equal(diaSemana('2026-10-31'), 'sabado');
    assert.equal(diaSemana('2026-11-02'), 'lunes');
    assert.equal(diaSemana('2026-11-04'), 'miercoles');
    assert.equal(diaSemana('2026-11-01'), 'domingo');
  });
  test('hoyISO usa la fecha local', () => {
    assert.equal(hoyISO(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  });
  test('sumarDias cruza meses y años', () => {
    assert.equal(sumarDias('2026-10-31', 1), '2026-11-01');
    assert.equal(sumarDias('2026-12-31', 1), '2027-01-01');
    assert.equal(sumarDias('2026-03-01', -1), '2026-02-28');
  });
  test('fechaLarga y fechaCorta muestran la fecha en español', () => {
    assert.equal(fechaLarga('2026-10-31'), 'sábado 31 de octubre de 2026');
    assert.equal(fechaCorta('2026-10-17'), 'Sáb 17 oct 2026');
  });
  test('cuandoEs dice hoy, mañana o el día de la semana', () => {
    assert.equal(cuandoEs('2026-10-29', '2026-10-29'), 'hoy');
    assert.equal(cuandoEs('2026-10-30', '2026-10-29'), 'mañana');
    assert.equal(cuandoEs('2026-10-31', '2026-10-29'), 'el sáb 31 oct');
  });
  test('nombreDia muestra el día con tilde', () => {
    assert.equal(nombreDia('miercoles'), 'Miércoles');
    assert.equal(nombreDia('sabado'), 'Sábado');
    assert.equal(nombreDia('lunes'), 'Lunes');
  });
});

describe('slots', () => {
  test('generarSlots arma los bloques de cada jornada activa, en orden', () => {
    assert.deepEqual(generarSlots(horarios, 'lunes'), [
      { inicio: '12:30', fin: '13:30' },
      { inicio: '13:30', fin: '14:30' },
      { inicio: '17:00', fin: '18:00' },
      { inicio: '18:00', fin: '19:00' },
      { inicio: '19:00', fin: '20:00' },
    ]);
  });
  test('generarSlots respeta la duración del slot y no se pasa del cierre', () => {
    assert.deepEqual(generarSlots(horarios, 'martes'), [
      { inicio: '17:00', fin: '17:30' },
      { inicio: '17:30', fin: '18:00' },
      { inicio: '18:00', fin: '18:30' },
    ]);
  });
  test('generarSlots ignora horarios inactivos y días sin horario', () => {
    assert.deepEqual(generarSlots(horarios, 'miercoles'), []);
    assert.deepEqual(generarSlots(horarios, 'domingo'), []);
  });
  test('seCruzan detecta cruces pero no bloques seguidos', () => {
    assert.equal(seCruzan({ inicio: '12:30', fin: '13:30' }, { inicio: '13:00', fin: '14:00' }), true);
    assert.equal(seCruzan({ inicio: '12:30', fin: '13:30' }, { inicio: '13:30', fin: '14:30' }), false);
    assert.equal(seCruzan({ inicio: '17:00', fin: '19:00' }, { inicio: '17:30', fin: '18:00' }), true);
  });
  test('marcarSlots marca ocupados los que se cruzan con una reserva', () => {
    const slots = generarSlots(horarios, 'lunes');
    const marcados = marcarSlots(slots, [{ hora_inicio: '17:00', hora_fin: '18:00' }]);
    assert.deepEqual(marcados.map((s) => s.estado), ['libre', 'libre', 'ocupado', 'libre', 'libre']);
  });
  test('marcarSlots marca como pasados los de hoy cuya hora ya llegó', () => {
    const slots = generarSlots(horarios, 'lunes');
    const marcados = marcarSlots(slots, [], { esHoy: true, ahora: '13:30' });
    assert.deepEqual(marcados.map((s) => s.estado), ['pasado', 'pasado', 'libre', 'libre', 'libre']);
  });
  test('estadoMesaHoy dice libre, ocupada o cerrado', () => {
    assert.equal(estadoMesaHoy([{ estado: 'ocupado' }, { estado: 'libre' }]), 'libre');
    assert.equal(estadoMesaHoy([{ estado: 'pasado' }, { estado: 'ocupado' }]), 'ocupada');
    assert.equal(estadoMesaHoy([{ estado: 'pasado' }, { estado: 'pasado' }]), 'cerrado');
    assert.equal(estadoMesaHoy([]), 'cerrado');
  });
});

describe('resumen del horario para el pie de página', () => {
  const dias = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
  const semana = dias.flatMap((d) => [
    { dia_semana: d, jornada: 'noche', hora_inicio: '17:00:00', hora_fin: '23:00:00', duracion_slot: 60, activo: true },
    { dia_semana: d, jornada: 'almuerzo', hora_inicio: '12:30:00', hora_fin: '14:30:00', duracion_slot: 60, activo: true },
  ]);
  test('si todos los días son iguales dice "Todos los días"', () => {
    assert.equal(resumenHorario(semana), 'Todos los días, de 12:30 a 14:30 y de 17:00 a 23:00.');
  });
  test('si cambian, muestra cada día y los cerrados', () => {
    const distinto = semana.map((h) => (h.dia_semana === 'lunes' ? { ...h, activo: false } : h));
    const texto = resumenHorario(distinto);
    assert.match(texto, /^Lunes: cerrado\. Martes: de 12:30 a 14:30 y de 17:00 a 23:00\./);
    assert.match(texto, /Domingo: de 12:30 a 14:30 y de 17:00 a 23:00\.$/);
  });
  test('sin horarios activos lo dice', () => {
    assert.equal(resumenHorario([]), 'Por ahora no hay horarios de atención.');
  });
});

describe('calendario', () => {
  test('fechasDisponibles incluye hoy y los próximos 30 días con horario', () => {
    // 2026-11-02 es lunes. Con este horario solo abren lunes y martes.
    const fechas = fechasDisponibles(horarios, '2026-11-02', '08:00');
    assert.equal(fechas[0], '2026-11-02');
    assert.equal(fechas[1], '2026-11-03');
    assert.equal(fechas[2], '2026-11-09');
    assert.ok(fechas.every((f) => ['lunes', 'martes'].includes(diaSemana(f))));
    assert.ok(fechas.every((f) => f <= '2026-12-02'));
    assert.ok(fechas.includes('2026-12-01'));
  });
  test('fechasDisponibles quita hoy si ya no quedan slots', () => {
    const fechas = fechasDisponibles(horarios, '2026-11-02', '19:00');
    assert.equal(fechas[0], '2026-11-03');
  });
  test('construirMes arma semanas de lunes a domingo', () => {
    const semanas = construirMes(2026, 9); // octubre de 2026 (empieza jueves)
    assert.deepEqual(semanas[0], [null, null, null, '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    assert.equal(semanas.at(-1).filter(Boolean).at(-1), '2026-10-31');
    assert.ok(semanas.every((s) => s.length === 7));
  });
});

describe('validación del formulario', () => {
  test('acepta una reserva correcta', () => {
    const r = validarReserva({ nombre: 'Juan Pérez', personas: '4', contacto: '300 123 4567' }, 6);
    assert.equal(r.valido, true);
    assert.deepEqual(r.errores, {});
  });
  test('el contacto es opcional', () => {
    assert.equal(validarReserva({ nombre: 'Ana', personas: 2, contacto: '' }, 2).valido, true);
  });
  test('pide nombre de al menos 2 letras', () => {
    const r = validarReserva({ nombre: ' a ', personas: 2 }, 4);
    assert.equal(r.valido, false);
    assert.match(r.errores.nombre, /nombre/i);
  });
  test('no deja más personas que la capacidad de la mesa', () => {
    const r = validarReserva({ nombre: 'Ana', personas: 5 }, 4);
    assert.equal(r.valido, false);
    assert.match(r.errores.personas, /máximo 4/);
  });
  test('pide un número de personas entero desde 1', () => {
    assert.match(validarReserva({ nombre: 'Ana', personas: '' }, 4).errores.personas, /número de personas/i);
    assert.match(validarReserva({ nombre: 'Ana', personas: 0 }, 4).errores.personas, /número de personas/i);
    assert.match(validarReserva({ nombre: 'Ana', personas: 2.5 }, 4).errores.personas, /número de personas/i);
  });
  test('revisa que el contacto parezca un teléfono', () => {
    assert.match(validarReserva({ nombre: 'Ana', personas: 2, contacto: 'hola' }, 4).errores.contacto, /teléfono/i);
  });
});

describe('mensajes de error', () => {
  test('traduce los códigos de la base de datos', () => {
    assert.match(mensajeError({ message: 'SLOT_OCUPADO' }), /acaba de ser reservado/);
    assert.match(mensajeError({ message: 'conflicting key value violates exclusion constraint "reservas_sin_cruce"' }), /se cruza con otra reserva/);
    assert.match(mensajeError({ message: 'CAPACIDAD_EXCEDIDA', details: 'La mesa admite máximo 4 personas.' }), /máximo 4 personas/);
    assert.match(mensajeError({ message: 'FECHA_INVALIDA' }), /fecha/);
    assert.match(mensajeError({ message: 'HORARIO_INVALIDO' }), /horario/);
    assert.match(mensajeError({ message: 'MESA_NO_DISPONIBLE' }), /mesa/);
  });
  test('traduce errores del panel admin', () => {
    assert.match(mensajeError({ message: 'update or delete on table "mesas" violates foreign key constraint "reservas_mesa_id_fkey"' }), /desactívala/);
    assert.match(mensajeError({ message: 'duplicate key value violates unique constraint "mesas_nombre_unico"' }), /Ya existe una mesa/);
    assert.match(mensajeError({ message: 'Invalid login credentials' }), /Correo o contraseña/);
    assert.match(mensajeError({ message: 'new row violates row-level security policy for table "mesas"' }), /permiso/);
  });
  test('traduce problemas de conexión', () => {
    assert.match(mensajeError(new TypeError('Failed to fetch')), /conexión/);
  });
  test('da un mensaje general para lo desconocido', () => {
    assert.match(mensajeError({ message: 'algo raro' }), /inesperado/);
    assert.match(mensajeError(undefined), /inesperado/);
  });
});

describe('formatos y utilidades', () => {
  test('formatoPrecio usa pesos colombianos con punto de miles', () => {
    assert.equal(formatoPrecio(42000), '$42.000');
    assert.equal(formatoPrecio(1250000), '$1.250.000');
    assert.equal(formatoPrecio(0), '$0');
  });
  test('paginar devuelve la página pedida y el total', () => {
    const lista = Array.from({ length: 24 }, (_, i) => i + 1);
    const p = paginar(lista, 3, 10);
    assert.deepEqual(p.items, [21, 22, 23, 24]);
    assert.equal(p.totalPaginas, 3);
    assert.equal(p.total, 24);
    assert.equal(paginar(lista, 99, 10).pagina, 3);
    assert.equal(paginar([], 1, 10).totalPaginas, 1);
  });
  test('agruparPlatos ordena por categoría y oculta los no disponibles', () => {
    const grupos = agruparPlatos([
      { nombre: 'Limonada', categoria: 'bebidas', disponible: true },
      { nombre: 'Hawaiana', categoria: 'pizzas', disponible: true },
      { nombre: 'Oculto', categoria: 'postres', disponible: false },
      { nombre: 'Pan de ajo', categoria: 'entradas', disponible: true },
    ]);
    assert.deepEqual(grupos.map((g) => g.titulo), ['Pizzas', 'Entradas', 'Bebidas']);
    assert.equal(grupos[0].platos[0].nombre, 'Hawaiana');
  });
  test('escaparHTML evita que un nombre meta código en la página', () => {
    assert.equal(escaparHTML('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    assert.equal(escaparHTML("O'Brien & Co"), 'O&#39;Brien &amp; Co');
    assert.equal(escaparHTML(null), '');
  });
  test('ordenarMesas pone Mesa 2 antes que Mesa 10', () => {
    const mesas = [{ nombre: 'Mesa 10' }, { nombre: 'Mesa 2' }, { nombre: 'Mesa 1' }];
    assert.deepEqual(ordenarMesas(mesas).map((m) => m.nombre), ['Mesa 1', 'Mesa 2', 'Mesa 10']);
  });
  test('avisa cuando el usuario no es administrador', () => {
    assert.match(mensajeError(new Error('NO_ES_ADMIN')), /no es administrador/);
  });
  test('nombreZona muestra la zona con tilde', () => {
    assert.equal(nombreZona('salon'), 'Salón');
    assert.equal(nombreZona('terraza'), 'Terraza');
  });
});
