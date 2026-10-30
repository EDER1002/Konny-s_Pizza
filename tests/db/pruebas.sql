-- Pruebas de supabase/schema.sql. Se corren con tests/db/correr.sh
-- Cada prueba imprime "ok - ..." o detiene todo con "FALLO - ...".
\set ON_ERROR_STOP on
set client_min_messages = notice;

-- ---------- Ayudas para las pruebas ----------
create schema pruebas;
grant usage on schema pruebas to anon, authenticated;

-- Fecha de hoy en Colombia más n días.
create function pruebas.dia(n int) returns date language sql stable as $$
  select (now() at time zone 'America/Bogota')::date + n
$$;

-- Ejecuta una consulta y exige que falle con un mensaje que contenga "patron".
create function pruebas.debe_fallar(nombre text, consulta text, patron text) returns void
language plpgsql as $$
begin
  begin
    execute consulta;
  exception when others then
    if sqlerrm ilike '%' || patron || '%' then
      raise notice 'ok - %', nombre;
      return;
    end if;
    raise exception 'FALLO - %: se esperaba "%" pero el error fue "%"', nombre, patron, sqlerrm;
  end;
  raise exception 'FALLO - %: se esperaba el error "%" y no hubo error', nombre, patron;
end $$;

-- Compara un valor obtenido con el esperado.
create function pruebas.igual(nombre text, obtenido anyelement, esperado anyelement) returns void
language plpgsql as $$
begin
  if obtenido is distinct from esperado then
    raise exception 'FALLO - %: se obtuvo "%" y se esperaba "%"', nombre, obtenido, esperado;
  end if;
  raise notice 'ok - %', nombre;
end $$;

grant execute on all functions in schema pruebas to anon, authenticated;

-- ---------- Datos base (como dueño de la base, sin RLS) ----------
insert into administradores (email) values ('admin@konys.test');
insert into mesas (id, nombre, zona, capacidad, activa) values
  (101, 'Mesa A', 'terraza', 4, true),
  (102, 'Mesa B', 'salon', 2, true),
  (103, 'Mesa C', 'salon', 6, false);
insert into platos (nombre, categoria, descripcion, precio, disponible) values
  ('Pizza prueba', 'pizzas', 'Queso y tomate', 30000, true),
  ('Postre oculto', 'postres', 'No disponible', 9000, false);

select pruebas.igual('el schema trae 14 horarios (7 días x 2 jornadas)', (select count(*)::int from horarios), 14);
select pruebas.igual('dia_semana_es convierte fechas a días en español', dia_semana_es('2026-10-31'), 'sabado');
select pruebas.igual('dia_semana_es para un lunes', dia_semana_es('2026-11-02'), 'lunes');
select pruebas.debe_fallar('no se repite el nombre de una mesa',
  $q$insert into mesas (nombre, zona, capacidad) values ('mesa a', 'salon', 2)$q$, 'mesas_nombre_unico');
select pruebas.debe_fallar('la zona solo puede ser terraza o salon',
  $q$insert into mesas (nombre, zona, capacidad) values ('Mesa Z', 'patio', 2)$q$, 'mesas_zona_check');

-- ---------- Cliente sin cuenta (rol anon) ----------
set role anon;
select pruebas.igual('anon lee las mesas', (select count(*)::int from mesas), 3);
select pruebas.igual('anon lee los horarios', (select count(*)::int from horarios), 14);
select pruebas.igual('anon lee la carta', (select count(*)::int from platos), 2);
select pruebas.debe_fallar('anon no puede crear mesas',
  $q$insert into mesas (nombre, zona, capacidad) values ('Mesa X', 'salon', 2)$q$, 'row-level security');
select pruebas.debe_fallar('anon no puede insertar reservas directo',
  format($q$insert into reservas (mesa_id, cliente_nombre, num_personas, fecha, hora_inicio, hora_fin)
            values (101, 'Ana', 2, %L, '12:30', '13:30')$q$, pruebas.dia(1)), 'row-level security');
select pruebas.debe_fallar('anon no puede ver la lista de administradores',
  'select count(*) from administradores', 'permission denied');
-- Estos cambios no deben tener efecto (RLS no deja tocar ninguna fila).
update mesas set capacidad = 99 where id = 101;
delete from horarios;
delete from platos;
reset role;
select pruebas.igual('anon no cambia mesas', (select capacidad from mesas where id = 101), 4);
select pruebas.igual('anon no borra horarios', (select count(*)::int from horarios), 14);
select pruebas.igual('anon no borra platos', (select count(*)::int from platos), 2);

-- ---------- Crear reservas (función crear_reserva) ----------
set role anon;
select pruebas.igual('crear_reserva calcula la hora de fin con la duración del slot',
  crear_reserva(101, pruebas.dia(1), '12:30', 'Juan Pérez', 3, ' 3001234567 ') ->> 'hora_fin', '13:30');
select pruebas.debe_fallar('no deja reservar un slot ocupado',
  format($q$select crear_reserva(101, %L, '12:30', 'María Gómez', 2)$q$, pruebas.dia(1)), 'SLOT_OCUPADO');
select pruebas.igual('la misma hora en otra mesa sí se puede',
  crear_reserva(102, pruebas.dia(1), '12:30', 'María Gómez', 2, '') ->> 'mesa_nombre', 'Mesa B');
select pruebas.igual('el slot siguiente de la misma mesa sí se puede',
  crear_reserva(101, pruebas.dia(1), '13:30', 'Laura Díaz', 4) ->> 'hora_inicio', '13:30');
select pruebas.debe_fallar('no deja pasar la capacidad de la mesa',
  format($q$select crear_reserva(102, %L, '17:00', 'Luis', 3)$q$, pruebas.dia(1)), 'CAPACIDAD_EXCEDIDA');
select pruebas.debe_fallar('no deja reservar una mesa inactiva',
  format($q$select crear_reserva(103, %L, '17:00', 'Luis', 2)$q$, pruebas.dia(1)), 'MESA_NO_DISPONIBLE');
select pruebas.debe_fallar('no deja reservar una mesa que no existe',
  format($q$select crear_reserva(999, %L, '17:00', 'Luis', 2)$q$, pruebas.dia(1)), 'MESA_NO_DISPONIBLE');
select pruebas.debe_fallar('no deja reservar fuera del horario',
  format($q$select crear_reserva(101, %L, '15:00', 'Luis', 2)$q$, pruebas.dia(1)), 'HORARIO_INVALIDO');
select pruebas.debe_fallar('no deja reservar una hora que no es un slot',
  format($q$select crear_reserva(101, %L, '12:45', 'Luis', 2)$q$, pruebas.dia(1)), 'HORARIO_INVALIDO');
select pruebas.debe_fallar('no deja un slot que termina después del cierre',
  format($q$select crear_reserva(101, %L, '14:30', 'Luis', 2)$q$, pruebas.dia(1)), 'HORARIO_INVALIDO');
select pruebas.debe_fallar('no deja reservar en una fecha pasada',
  format($q$select crear_reserva(101, %L, '17:00', 'Luis', 2)$q$, pruebas.dia(-1)), 'FECHA_INVALIDA');
select pruebas.debe_fallar('no deja reservar a más de 30 días',
  format($q$select crear_reserva(101, %L, '17:00', 'Luis', 2)$q$, pruebas.dia(31)), 'FECHA_INVALIDA');
select pruebas.igual('sí deja reservar a 30 días',
  crear_reserva(101, pruebas.dia(30), '17:00', 'Ana Ruiz', 2) ->> 'fecha', to_char(pruebas.dia(30), 'YYYY-MM-DD'));
select pruebas.debe_fallar('el nombre es obligatorio',
  format($q$select crear_reserva(101, %L, '18:00', '   ', 2)$q$, pruebas.dia(1)), 'NOMBRE_INVALIDO');
select pruebas.debe_fallar('el número de personas debe ser al menos 1',
  format($q$select crear_reserva(101, %L, '18:00', 'Luis', 0)$q$, pruebas.dia(1)), 'PERSONAS_INVALIDAS');
select pruebas.debe_fallar('el contacto no puede ser muy largo',
  format($q$select crear_reserva(101, %L, '18:00', 'Luis', 2, %L)$q$, pruebas.dia(1), repeat('1', 41)), 'CONTACTO_INVALIDO');
select pruebas.igual('anon no ve las reservas de otros', (select count(*)::int from reservas), 0);
select pruebas.igual('obtener_ocupados muestra los slots tomados',
  (select count(*)::int from obtener_ocupados(pruebas.dia(1)) where mesa_id = 101), 2);
select pruebas.igual('obtener_ocupados no entrega datos personales',
  (select array_agg(k order by k) from (select distinct json_object_keys(row_to_json(o)) k
     from obtener_ocupados(pruebas.dia(1)) o) s), array['hora_fin', 'hora_inicio', 'mesa_id']);
select pruebas.igual('anon no es administrador', es_admin(), false);
reset role;

select pruebas.igual('el contacto se guarda sin espacios',
  (select cliente_contacto from reservas where cliente_nombre = 'Juan Pérez'), '3001234567');
select pruebas.igual('un contacto vacío se guarda como null',
  (select cliente_contacto is null from reservas where cliente_nombre = 'María Gómez'), true);
select pruebas.igual('la reserva nueva queda confirmada',
  (select estado from reservas where cliente_nombre = 'Juan Pérez'), 'confirmada');
select pruebas.debe_fallar('la base de datos impide reservas cruzadas aunque se inserten directo',
  format($q$insert into reservas (mesa_id, cliente_nombre, num_personas, fecha, hora_inicio, hora_fin)
            values (101, 'Cruce', 2, %L, '13:00', '14:00')$q$, pruebas.dia(1)), 'reservas_sin_cruce');

-- ---------- Usuario con cuenta que NO es administrador ----------
set role authenticated;
select set_config('request.jwt.claims', '{"email":"otro@correo.com","role":"authenticated"}', false);
select pruebas.igual('un usuario cualquiera no es administrador', es_admin(), false);
select pruebas.debe_fallar('un usuario cualquiera no crea mesas',
  $q$insert into mesas (nombre, zona, capacidad) values ('Mesa X', 'salon', 2)$q$, 'row-level security');
select pruebas.igual('un usuario cualquiera no ve reservas', (select count(*)::int from reservas), 0);
reset role;

-- ---------- Administrador ----------
set role authenticated;
select set_config('request.jwt.claims', '{"email":"Admin@Konys.test","role":"authenticated"}', false);
select pruebas.igual('es_admin reconoce al admin sin importar mayúsculas', es_admin(), true);

insert into mesas (nombre, zona, capacidad, foto_url) values ('Mesa Nueva', 'terraza', 4, 'https://ejemplo.com/foto.jpg');
select pruebas.igual('el admin crea mesas', (select count(*)::int from mesas where nombre = 'Mesa Nueva'), 1);
update mesas set activa = false where nombre = 'Mesa Nueva';
select pruebas.igual('el admin activa y desactiva mesas', (select activa from mesas where nombre = 'Mesa Nueva'), false);
delete from mesas where nombre = 'Mesa Nueva';
select pruebas.igual('el admin borra una mesa sin reservas', (select count(*)::int from mesas where nombre = 'Mesa Nueva'), 0);
select pruebas.debe_fallar('no se puede borrar una mesa con reservas', 'delete from mesas where id = 101', 'foreign key');

select pruebas.igual('el admin ve todas las reservas', (select count(*)::int from reservas), 4);
update reservas set estado = 'cancelada' where mesa_id = 101 and fecha = pruebas.dia(1) and hora_inicio = '12:30';
select pruebas.igual('una reserva cancelada libera el slot',
  (select count(*)::int from obtener_ocupados(pruebas.dia(1)) where mesa_id = 101 and hora_inicio = '12:30'), 0);
select pruebas.debe_fallar('el admin no puede poner más personas que la capacidad',
  'update reservas set num_personas = 10 where mesa_id = 102', 'CAPACIDAD_EXCEDIDA');

insert into platos (nombre, categoria, descripcion, precio) values ('Pizza nueva', 'pizzas', 'Pepperoni', 35000);
update platos set disponible = false, precio = 36000 where nombre = 'Pizza nueva';
select pruebas.igual('el admin edita y oculta platos',
  (select disponible::text || '-' || precio from platos where nombre = 'Pizza nueva'), 'false-36000');
delete from platos where nombre = 'Pizza nueva';
select pruebas.igual('el admin borra platos', (select count(*)::int from platos where nombre = 'Pizza nueva'), 0);
select pruebas.debe_fallar('el precio no puede ser negativo',
  $q$insert into platos (nombre, categoria, precio) values ('Mal', 'pizzas', -1)$q$, 'platos_precio_check');

update horarios set activo = false where dia_semana = dia_semana_es(pruebas.dia(2)) and jornada = 'almuerzo';
update horarios set duracion_slot = 30 where dia_semana = dia_semana_es(pruebas.dia(3)) and jornada = 'noche';
select pruebas.igual('el admin edita horarios', (select count(*)::int from horarios where duracion_slot = 30), 1);
select pruebas.debe_fallar('la hora de cierre debe ser mayor que la de apertura',
  $q$update horarios set hora_fin = '10:00' where jornada = 'almuerzo'$q$, 'horarios_horas_check');
reset role;
select set_config('request.jwt.claims', '', false);

set role anon;
select pruebas.igual('un slot liberado se puede volver a reservar',
  crear_reserva(101, pruebas.dia(1), '12:30', 'Pedro Gómez', 2) ->> 'hora_inicio', '12:30');
select pruebas.debe_fallar('un horario desactivado no acepta reservas',
  format($q$select crear_reserva(101, %L, '12:30', 'Luis', 2)$q$, pruebas.dia(2)), 'HORARIO_INVALIDO');
select pruebas.igual('con slots de 30 minutos acepta las :30',
  crear_reserva(101, pruebas.dia(3), '17:30', 'Sofía Ruiz', 2) ->> 'hora_fin', '18:00');
reset role;

set role authenticated;
select set_config('request.jwt.claims', '{"email":"admin@konys.test","role":"authenticated"}', false);
select pruebas.debe_fallar('volver a confirmar una reserva cancelada no puede cruzarse con otra',
  $q$update reservas set estado = 'confirmada' where cliente_nombre = 'Juan Pérez'$q$, 'reservas_sin_cruce');
reset role;
select set_config('request.jwt.claims', '', false);

\echo 'TODAS LAS PRUEBAS DE LA BASE DE DATOS PASARON'
