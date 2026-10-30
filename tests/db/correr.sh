#!/usr/bin/env bash
# Corre las pruebas de supabase/schema.sql en un Postgres local temporal.
# Requisitos: PostgreSQL 15 o superior instalado (initdb, pg_ctl y psql).
# Uso: bash tests/db/correr.sh   (no correr como root)
set -euo pipefail

AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"

# En Debian/Ubuntu los programas de Postgres no están en el PATH.
for d in /usr/lib/postgresql/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done

TMP="$(mktemp -d)"
PUERTO=54329
initdb -D "$TMP/data" -U postgres -A trust >/dev/null
pg_ctl -D "$TMP/data" -l "$TMP/log" -o "-k $TMP -p $PUERTO -c listen_addresses=''" -w start >/dev/null
trap 'pg_ctl -D "$TMP/data" -m fast stop >/dev/null 2>&1; rm -rf "$TMP"' EXIT

psql -h "$TMP" -p "$PUERTO" -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
  -f "$AQUI/stubs.sql" \
  -f "$RAIZ/supabase/schema.sql" \
  -f "$AQUI/pruebas.sql" 2>&1 \
  | sed 's/^psql:[^ ]* NOTICE:  //' \
  | grep -E 'ok - |FALLO|ERROR|PASARON'

# Base aparte para revisar que los datos de ejemplo carguen bien.
createdb -h "$TMP" -p "$PUERTO" -U postgres ejemplo
psql -h "$TMP" -p "$PUERTO" -U postgres -d ejemplo -X -q -v ON_ERROR_STOP=1 \
  -f "$AQUI/stubs.sql" \
  -f "$RAIZ/supabase/schema.sql" \
  -f "$RAIZ/supabase/datos-ejemplo.sql" \
  -f "$AQUI/ejemplo.sql" 2>&1 \
  | sed 's/^psql:[^ ]* NOTICE:  //' \
  | grep -E 'ok - |FALLO|ERROR'
