-- =====================================================================
-- Konys Pizza · Migración 001 · Endurecimiento de seguridad
--
-- Para quien YA tiene la base creada en Supabase. Pega TODO este archivo en
-- SQL Editor > New query y dale Run. Se puede correr más de una vez sin
-- problema (es idempotente) y no borra ninguna reserva, mesa ni plato.
--
-- Qué hace:
--  1. Quita permisos de sobra a anon/authenticated (TRUNCATE, escribir, etc.).
--  2. Las funciones usan search_path vacío (evita secuestro de funciones).
--  3. Valida en el servidor el nombre (sin < > ni saltos de línea) y el
--     teléfono (solo números, +, paréntesis, guiones y espacios).
--  4. Fotos de mesas solo con https://
--  5. Límite de 10 reservas por hora desde la misma IP (se guarda un hash).
-- =====================================================================
begin;

-- 5. Tabla del limitador.
create table if not exists public.intentos_reserva (
  ip_hash    text not null,
  creado_en  timestamptz not null default now()
);
create index if not exists intentos_reserva_idx on public.intentos_reserva (ip_hash, creado_en);

-- 3 y 4. Reglas en las tablas. "not valid" = se aplican a lo nuevo y no
-- fallan por datos viejos que ya estén guardados.
alter table public.reservas drop constraint if exists reservas_nombre_check;
alter table public.reservas add  constraint reservas_nombre_check
  check (char_length(btrim(cliente_nombre)) between 2 and 80 and cliente_nombre !~ '[<>[:cntrl:]]') not valid;
alter table public.reservas drop constraint if exists reservas_contacto_check;
alter table public.reservas add  constraint reservas_contacto_check
  check (cliente_contacto is null or cliente_contacto ~ '^[0-9+() -]{7,20}$') not valid;
alter table public.mesas drop constraint if exists mesas_foto_check;
alter table public.mesas add  constraint mesas_foto_check
  check (foto_url is null or (foto_url ~* '^https://[^[:space:]<>"]+$' and char_length(foto_url) <= 500)) not valid;
alter table public.platos drop constraint if exists platos_descripcion_check;
alter table public.platos add  constraint platos_descripcion_check
  check (descripcion is null or char_length(descripcion) <= 300) not valid;

-- 2, 3 y 5. Funciones actualizadas.
-- Nombre del día en español (sin tildes), igual que en la tabla horarios.
create or replace function public.dia_semana_es(p_fecha date) returns text
language sql immutable set search_path = '' as $$
  select (array['lunes','martes','miercoles','jueves','viernes','sabado','domingo'])[extract(isodow from p_fecha)::int]
$$;

-- ¿El usuario que hace la consulta es administrador?
create or replace function public.es_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.administradores a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
$$;

-- Nunca deja guardar más personas que la capacidad de la mesa.
create or replace function public.validar_capacidad() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_capacidad integer;
begin
  select capacidad into v_capacidad from public.mesas where id = new.mesa_id;
  if v_capacidad is not null and new.num_personas > v_capacidad then
    raise exception 'CAPACIDAD_EXCEDIDA'
      using detail = format('La mesa admite máximo %s personas.', v_capacidad);
  end if;
  return new;
end $$;


-- Slots ocupados de un día. Solo devuelve mesa y horas, nunca datos
-- personales, por eso el público puede usarla sin ver la tabla reservas.
create or replace function public.obtener_ocupados(p_fecha date)
returns table (mesa_id bigint, hora_inicio text, hora_fin text)
language sql stable security definer set search_path = '' as $$
  select r.mesa_id, to_char(r.hora_inicio, 'HH24:MI'), to_char(r.hora_fin, 'HH24:MI')
  from public.reservas r
  where r.fecha = p_fecha and r.estado <> 'cancelada'
  order by r.mesa_id, r.hora_inicio
$$;

-- Crea una reserva revisando todas las reglas en un solo paso.
-- Errores posibles: MESA_NO_DISPONIBLE, NOMBRE_INVALIDO, CONTACTO_INVALIDO,
-- PERSONAS_INVALIDAS, CAPACIDAD_EXCEDIDA, FECHA_INVALIDA, HORARIO_INVALIDO,
-- SLOT_OCUPADO, DEMASIADAS_RESERVAS.
create or replace function public.crear_reserva(
  p_mesa_id          bigint,
  p_fecha            date,
  p_hora_inicio      time,
  p_cliente_nombre   text,
  p_num_personas     integer,
  p_cliente_contacto text default null
) returns json
language plpgsql security definer set search_path = '' as $$
declare
  v_mesa      public.mesas;
  v_horario   public.horarios;
  v_hoy       date := (now() at time zone 'America/Bogota')::date;
  v_ahora     time := (now() at time zone 'America/Bogota')::time;
  v_nombre    text := btrim(coalesce(p_cliente_nombre, ''));
  v_contacto  text := nullif(btrim(coalesce(p_cliente_contacto, '')), '');
  v_minuto    integer;
  v_hora_fin  time;
  v_id        bigint;
  v_ip        text;
  v_ip_hash   text;
begin
  select * into v_mesa from public.mesas where id = p_mesa_id;
  if not found or not v_mesa.activa then
    raise exception 'MESA_NO_DISPONIBLE';
  end if;

  if char_length(v_nombre) not between 2 and 80 or v_nombre ~ '[<>[:cntrl:]]' then
    raise exception 'NOMBRE_INVALIDO';
  end if;
  if v_contacto is not null and v_contacto !~ '^[0-9+() -]{7,20}$' then
    raise exception 'CONTACTO_INVALIDO';
  end if;
  if p_num_personas is null or p_num_personas < 1 then
    raise exception 'PERSONAS_INVALIDAS';
  end if;
  if p_num_personas > v_mesa.capacidad then
    raise exception 'CAPACIDAD_EXCEDIDA'
      using detail = format('La mesa admite máximo %s personas.', v_mesa.capacidad);
  end if;

  -- Solo desde hoy hasta 30 días, y nunca una hora que ya pasó.
  if p_fecha is null or p_fecha < v_hoy or p_fecha > v_hoy + 30
     or (p_fecha = v_hoy and p_hora_inicio <= v_ahora) then
    raise exception 'FECHA_INVALIDA';
  end if;

  -- La hora debe ser el inicio de un slot de una jornada activa de ese día.
  v_minuto := extract(epoch from p_hora_inicio)::integer / 60;
  select h.* into v_horario
  from public.horarios h
  where h.dia_semana = public.dia_semana_es(p_fecha)
    and h.activo
    and v_minuto >= extract(epoch from h.hora_inicio)::integer / 60
    and v_minuto + h.duracion_slot <= extract(epoch from h.hora_fin)::integer / 60
    and (v_minuto - extract(epoch from h.hora_inicio)::integer / 60) % h.duracion_slot = 0
  limit 1;
  if not found then
    raise exception 'HORARIO_INVALIDO';
  end if;

  v_hora_fin := p_hora_inicio + make_interval(mins => v_horario.duracion_slot);

  -- Límite por origen: máximo 10 reservas por hora desde la misma IP.
  -- La IP la pone el proxy de Supabase (cabecera cf-connecting-ip). Si no
  -- hay cabecera (pruebas locales) no se limita.
  begin
    v_ip := coalesce(
      nullif(btrim(current_setting('request.headers', true)::json ->> 'cf-connecting-ip'), ''),
      nullif(btrim(split_part(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ',', 1)), '')
    );
  exception when others then
    v_ip := null;
  end;
  if v_ip is not null then
    v_ip_hash := encode(sha256(convert_to('konys:' || v_ip, 'UTF8')), 'hex');
    delete from public.intentos_reserva where creado_en < now() - interval '1 day';
    if (select count(*) from public.intentos_reserva
        where ip_hash = v_ip_hash and creado_en > now() - interval '1 hour') >= 10 then
      raise exception 'DEMASIADAS_RESERVAS';
    end if;
  end if;

  begin
    insert into public.reservas (mesa_id, cliente_nombre, cliente_contacto, num_personas, fecha, hora_inicio, hora_fin)
    values (p_mesa_id, v_nombre, v_contacto, p_num_personas, p_fecha, p_hora_inicio, v_hora_fin)
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'SLOT_OCUPADO';
  end;

  if v_ip_hash is not null then
    insert into public.intentos_reserva (ip_hash) values (v_ip_hash);
  end if;

  return json_build_object(
    'id',             v_id,
    'mesa_id',        v_mesa.id,
    'mesa_nombre',    v_mesa.nombre,
    'zona',           v_mesa.zona,
    'fecha',          to_char(p_fecha, 'YYYY-MM-DD'),
    'hora_inicio',    to_char(p_hora_inicio, 'HH24:MI'),
    'hora_fin',       to_char(v_hora_fin, 'HH24:MI'),
    'num_personas',   p_num_personas,
    'cliente_nombre', v_nombre
  );
end $$;

-- 1. Permisos mínimos.
alter table public.intentos_reserva enable row level security;

-- Permisos mínimos (principio de menor privilegio). Supabase da por defecto
-- TODOS los permisos a anon y authenticated; aquí se quitan y se devuelven
-- solo los necesarios. Además de RLS, esto impide TRUNCATE (que RLS no frena).
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

-- Público: solo leer mesas, horarios y carta.
grant select on public.mesas, public.horarios, public.platos to anon, authenticated;
-- Administrador (sesión iniciada): gestiona todo salvo TRUNCATE, y RLS exige es_admin().
grant select, insert, update, delete on public.mesas, public.horarios, public.platos, public.reservas to authenticated;
grant usage on all sequences in schema public to authenticated;
-- administradores e intentos_reserva: nadie desde la app (solo el dueño de la base).

-- Solo estas tres funciones se pueden llamar desde la app.
grant execute on function public.crear_reserva(bigint, date, time, text, integer, text) to anon, authenticated;
grant execute on function public.obtener_ocupados(date) to anon, authenticated;
grant execute on function public.es_admin() to anon, authenticated;

-- Lo que se cree en el futuro tampoco debe heredar permisos amplios.
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;

commit;

-- Comprobación rápida (opcional): debe dar false en las tres columnas.
-- select has_table_privilege('anon','public.reservas','TRUNCATE') as anon_truncate,
--        has_table_privilege('anon','public.mesas','INSERT')       as anon_insert_mesas,
--        has_function_privilege('anon','public.dia_semana_es(date)','EXECUTE') as anon_funcion_interna;
