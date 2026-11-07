-- =====================================================================
-- Konny's Pizza · Migración 002 · Sesión administrativa sin persistencia
-- y vencimiento por cinco minutos de inactividad.
--
-- Ejecutar DESPUÉS de 001-seguridad.sql en Supabase > SQL Editor.
-- No crea roles nuevos, no modifica reservas y conserva administradores.
-- Cada fila se identifica con el session_id firmado por Supabase Auth.
-- Las políticas RLS rechazan operaciones administrativas si no existe un
-- heartbeat de esa sesión durante los últimos cinco minutos.
-- =====================================================================
begin;

create table if not exists public.sesiones_admin_actividad (
  session_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  ultima_actividad timestamptz not null default now()
);

alter table public.mesas enable row level security;
alter table public.horarios enable row level security;
alter table public.platos enable row level security;
alter table public.reservas enable row level security;
alter table public.administradores enable row level security;
alter table public.sesiones_admin_actividad enable row level security;
revoke all on table public.sesiones_admin_actividad from public, anon, authenticated;

-- Mantiene el mecanismo de autorización existente y exige una identidad Auth.
create or replace function public.es_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.administradores a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
$$;

-- La sesión solo está vigente si Supabase Auth todavía reconoce su session_id
-- y el último heartbeat fue recibido hace menos de cinco minutos.
create or replace function public.sesion_admin_activa() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and public.es_admin()
    and nullif(auth.jwt() ->> 'session_id', '') is not null
    and exists (
      select 1
      from auth.sessions s
      join public.sesiones_admin_actividad a on a.session_id = s.id
      where s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid
        and s.user_id = auth.uid()
        and a.user_id = auth.uid()
        and a.ultima_actividad > now() - interval '5 minutes'
    )
$$;

-- Inicia/renueva actividad. Un registro ya vencido no se puede reactivar:
-- la cláusula WHERE del UPSERT impide resucitar una sesión inactiva.
create or replace function public.registrar_actividad_admin() returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_usuario uuid := auth.uid();
  v_sesion uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
begin
  if v_usuario is null or v_sesion is null or not public.es_admin() then
    raise exception 'NO_ES_ADMIN' using errcode = '42501';
  end if;

  if not exists (
    select 1 from auth.sessions s where s.id = v_sesion and s.user_id = v_usuario
  ) then
    raise exception 'SESION_ADMIN_EXPIRADA' using errcode = '42501';
  end if;

  delete from public.sesiones_admin_actividad a
  where a.ultima_actividad < now() - interval '1 day'
    and not exists (select 1 from auth.sessions s where s.id = a.session_id);

  insert into public.sesiones_admin_actividad (session_id, user_id, ultima_actividad)
  values (v_sesion, v_usuario, now())
  on conflict (session_id) do update
    set ultima_actividad = excluded.ultima_actividad
    where public.sesiones_admin_actividad.user_id = excluded.user_id
      and public.sesiones_admin_actividad.ultima_actividad > now() - interval '5 minutes';

  if not found then
    raise exception 'SESION_ADMIN_EXPIRADA' using errcode = '42501';
  end if;

  return true;
end $$;

-- Limpia el heartbeat antes de cerrar la sesión actual.
create or replace function public.cerrar_sesion_admin() returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_sesion uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
begin
  if auth.uid() is null or v_sesion is null then
    return false;
  end if;
  delete from public.sesiones_admin_actividad
  where session_id = v_sesion and user_id = auth.uid();
  return true;
end $$;

-- Reconstruye las políticas estándar de estas cuatro tablas. PostgreSQL
-- combina políticas permisivas mediante OR; una política adicional podría
-- anular el nuevo control. Solo elimina los nombres del esquema original y
-- aborta si detecta políticas personalizadas para no borrarlas a escondidas.
do $$
declare
  v_politica record;
begin
  for v_politica in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('mesas', 'horarios', 'platos', 'reservas')
  loop
    if v_politica.policyname not in (
      'Todos ven las mesas', 'Todos ven los horarios', 'Todos ven la carta',
      'El admin gestiona mesas', 'El admin gestiona horarios',
      'El admin gestiona la carta', 'El admin gestiona reservas'
    ) then
      raise exception 'POLITICA_RLS_NO_RECONOCIDA: %.% — revísala antes de aplicar la migración.',
        v_politica.tablename, v_politica.policyname;
    end if;
    execute format('drop policy if exists %I on public.%I', v_politica.policyname, v_politica.tablename);
  end loop;
end $$;

-- Se conservan las lecturas necesarias para la aplicación pública.
create policy "Todos ven las mesas" on public.mesas
  for select to anon, authenticated using (true);
create policy "Todos ven los horarios" on public.horarios
  for select to anon, authenticated using (true);
create policy "Todos ven la carta" on public.platos
  for select to anon, authenticated using (true);

create policy "El admin gestiona mesas" on public.mesas
  for all to authenticated
  using (public.es_admin() and public.sesion_admin_activa())
  with check (public.es_admin() and public.sesion_admin_activa());
create policy "El admin gestiona horarios" on public.horarios
  for all to authenticated
  using (public.es_admin() and public.sesion_admin_activa())
  with check (public.es_admin() and public.sesion_admin_activa());
create policy "El admin gestiona la carta" on public.platos
  for all to authenticated
  using (public.es_admin() and public.sesion_admin_activa())
  with check (public.es_admin() and public.sesion_admin_activa());
create policy "El admin gestiona reservas" on public.reservas
  for all to authenticated
  using (public.es_admin() and public.sesion_admin_activa())
  with check (public.es_admin() and public.sesion_admin_activa());

revoke all on function public.es_admin() from public, anon;
grant execute on function public.es_admin() to authenticated;
revoke all on function public.sesion_admin_activa() from public, anon;
grant execute on function public.sesion_admin_activa() to authenticated;
revoke all on function public.registrar_actividad_admin() from public, anon;
grant execute on function public.registrar_actividad_admin() to authenticated;
revoke all on function public.cerrar_sesion_admin() from public, anon;
grant execute on function public.cerrar_sesion_admin() to authenticated;

commit;
