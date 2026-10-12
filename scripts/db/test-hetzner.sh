#!/usr/bin/env bash
# Applies every hetzner migration in order to a throwaway Postgres database, then runs the extra sql files.
# Usage: bash scripts/db/test-hetzner.sh [extra.sql ...]
# Locally it uses the machine's postgres. In CI (CI_PG=1) it connects to localhost as postgres/postgres.
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=bx_hz_test_$$
if [ -n "${CI_PG:-}" ]; then
  export PGPASSWORD=postgres
  admin() { psql -q -h localhost -U postgres -d postgres -c "$1" >/dev/null; }
  run() { psql -v ON_ERROR_STOP=1 -q -h localhost -U postgres -d "$DB" -f "$1"; }
else
  admin() { su postgres -c "psql -q -c '$1'" >/dev/null; }
  run() { su postgres -c "psql -v ON_ERROR_STOP=1 -q -d $DB -f $1"; }
fi
admin "create database $DB"
trap 'admin "drop database $DB"' EXIT
for f in hetzner/migrations/*.sql; do echo "applying $f"; run "$PWD/$f"; done
for f in "$@"; do echo "running $f"; run "$(realpath "$f")"; done
echo "OK"
