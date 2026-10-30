-- Imita lo mínimo de Supabase para probar schema.sql en un Postgres local:
-- roles anon / authenticated, el esquema auth con auth.jwt() y auth.uid(),
-- y los permisos que Supabase da por defecto en el esquema public.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    -- Rol con el que se conecta PostgREST (solo para la prueba en navegador).
    create role authenticator login noinherit password 'authenticator';
    grant anon, authenticated, service_role to authenticator;
  end if;
end $$;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
