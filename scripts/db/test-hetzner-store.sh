#!/usr/bin/env bash
# Runs the API's Postgres store tests against a throwaway hetzner style database.
# Creates the three login users with throwaway passwords, applies the hetzner migrations, then runs vitest.
# Usage: bash scripts/db/test-hetzner-store.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=bx_hz_store_$$
PW=throwaway_$$
if [ -n "${CI_PG:-}" ]; then
  export PGPASSWORD=postgres
    admin() { psql -q -h localhost -U postgres -d postgres -c "$1" >/dev/null; }
  run() { psql -v ON_ERROR_STOP=1 -q -h localhost -U postgres -d "$DB" -f "$1"; }
else
    admin() { su postgres -c "psql -q" <<<"$1" >/dev/null; }
  run() { su postgres -c "psql -v ON_ERROR_STOP=1 -q -d $DB -f $1"; }
fi
admin "create database $DB"
cleanup() { admin "drop database $DB"; admin "drop role if exists bx_test_reader"; admin "drop role if exists bx_test_writer"; admin "drop role if exists bx_test_admin"; }
trap cleanup EXIT
for f in hetzner/migrations/*.sql; do run "$PWD/$f"; done
admin "create role bx_test_reader login password '$PW' in role console_read"
admin "create role bx_test_writer login password '$PW' in role console_write"
admin "create role bx_test_admin login superuser password '$PW'"
export HETZNER_TEST_ADMIN_URL="postgres://bx_test_admin:$PW@localhost:5432/$DB"
export HETZNER_TEST_READ_URL="postgres://bx_test_reader:$PW@localhost:5432/$DB"
export HETZNER_TEST_WRITE_URL="postgres://bx_test_writer:$PW@localhost:5432/$DB"
npm run build:shared >/dev/null
npx -w @beyondx/api vitest run src/hetzner
