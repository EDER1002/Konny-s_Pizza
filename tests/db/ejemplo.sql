-- Revisa que supabase/datos-ejemplo.sql cargue completo sobre schema.sql.
\set ON_ERROR_STOP on
do $$
begin
  if (select count(*) from public.mesas) <> 5 then raise exception 'FALLO - datos de ejemplo: se esperaban 5 mesas'; end if;
  if (select count(*) from public.platos) <> 26 then raise exception 'FALLO - datos de ejemplo: se esperaban 26 platos'; end if;
  if (select count(*) from public.reservas) <> 6 then raise exception 'FALLO - datos de ejemplo: se esperaban 6 reservas'; end if;
  raise notice 'ok - los datos de ejemplo cargan completos (5 mesas, 26 platos, 6 reservas)';
end $$;
