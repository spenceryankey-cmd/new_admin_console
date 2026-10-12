#!/usr/bin/env bash
# Tests scripts/import-from-legacy.mjs against throwaway databases: a fake legacy database shaped like the
# Prisma tables ("Worker", "Employer", with some columns missing on purpose) and a fresh hetzner database.
# Usage: bash scripts/db/test-import.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
PW=throwaway_$$
LDB=bx_legacy_$$; TDB=bx_target_$$
if [ -n "${CI_PG:-}" ]; then
  export PGPASSWORD=postgres
  admin() { psql -q -h localhost -U postgres -d postgres -c "$1" >/dev/null; }
  runin() { psql -v ON_ERROR_STOP=1 -q -h localhost -U postgres -d "$1" -f "$2"; }
  sqlin() { psql -v ON_ERROR_STOP=1 -q -h localhost -U postgres -d "$1" -At -c "$2"; }
else
  admin() { su postgres -c "psql -q" <<<"$1" >/dev/null; }
  runin() { su postgres -c "psql -v ON_ERROR_STOP=1 -q -d $1 -f $2"; }
  sqlin() { su postgres -c "psql -v ON_ERROR_STOP=1 -q -At -d $1" <<<"$2"; }
fi
admin "create role bx_imp_admin login superuser password '$PW'"
admin "create database $LDB"; admin "create database $TDB"
cleanup() { admin "drop database $LDB"; admin "drop database $TDB"; admin "drop role if exists bx_imp_admin"; }
trap cleanup EXIT
for f in hetzner/migrations/*.sql; do runin "$TDB" "$PWD/$f"; done
cat > /tmp/legacy_$$.sql <<'SQL'
create table "Worker" (id uuid primary key, "workerId" text, "fullName" text, "pinHash" text, phone text, "prisonFacility" text, "releaseDate" date,
  "offenseLevel" text, "offenseNotes" text, skills text[], bio text, "dailyCharge" numeric, "gpsVerified" boolean, "idVerified" boolean, "idType" text,
  "idCardNumber" text, "guarantorName" text, "guarantorPhone" text, "guarantorRelationship" text, "homeArea" text, "isActive" boolean, role text, "createdAt" timestamptz);
create table "Employer" (id uuid primary key, email text, "passwordHash" text, "orgName" text, "contactPerson" text, phone text, region text, "isVerified" boolean, "createdAt" timestamptz);
insert into "Worker" values
 ('11111111-1111-4111-8111-111111111111','W-1','Ama Plumber','h1','0501','Somewhere','2027-01-01','minor','note',array['Plumbing installation & repair','Skilled Trades','Tiling','Plumbing'],'bio',90,true,true,'ghana_card','GHA-123456789-0','Esi','0200','aunt','Madina',true,'worker','2026-01-01'),
 ('22222222-2222-4222-8222-222222222222','W-2','Kofi Off','h2','0502',null,null,'none',null,array[]::text[],null,80,false,false,null,null,null,null,null,null,false,'worker','2026-02-01'),
 ('33333333-3333-4333-8333-333333333333','W-3','Coord','h3','0503',null,null,'none',null,array[]::text[],null,80,false,false,null,null,null,null,null,null,true,'coordinator','2026-03-01'),
 ('44444444-4444-4444-8444-444444444444','W-4','Dup One','h4','0599',null,null,'none',null,array['Tree planting'],null,80,false,false,null,null,null,null,null,null,true,'worker','2026-03-01'),
 ('55555555-5555-4555-8555-555555555555','W-5','Dup Two','h5','0599',null,null,'none',null,array[]::text[],null,80,false,false,null,null,null,null,null,null,true,'worker','2026-03-02');
insert into "Employer" values ('99999999-9999-4999-8999-999999999999','boss@example.com','eh','Acme','Joy','0244','Accra',true,'2026-01-01');
SQL
chmod 644 /tmp/legacy_$$.sql
runin "$LDB" /tmp/legacy_$$.sql; rm -f /tmp/legacy_$$.sql
export LEGACY_DATABASE_URL="postgres://bx_imp_admin:$PW@localhost:5432/$LDB"
export HETZNER_ADMIN_DATABASE_URL="postgres://bx_imp_admin:$PW@localhost:5432/$TDB"
export IMPORT_SSL=disable ID_HASH_SECRET=test-secret
check() { [ "$(sqlin "$TDB" "$1")" = "$2" ] || { echo "FAILED: $3 (got $(sqlin "$TDB" "$1"), want $2)"; exit 1; }; }

echo "dry run"
out=$(node scripts/import-from-legacy.mjs); echo "$out"
echo "$out" | grep -q "DRY RUN" && echo "$out" | grep -q 'unmatched skill: "Plumbing"'
check "select count(*) from xpert" 0 "dry run wrote nothing"

echo "apply without a status decision must refuse"
if node scripts/import-from-legacy.mjs --apply >/dev/null 2>&1; then echo "FAILED: applied without a status decision"; exit 1; fi

echo "apply"
node scripts/import-from-legacy.mjs --apply --existing-active-status=provisional_active
check "select count(*) from xpert" 4 "four Xperts (coordinator skipped)"
check "select xpert_status || ',' || account_active from xpert where xpert_code='W-1'" "provisional_active,true" "active Xpert status"
check "select xpert_status || ',' || account_active from xpert where xpert_code='W-2'" "inactive,false" "switched off Xpert becomes inactive"
check "select count(*) from xpert_status_history" 4 "one history row each"
check "select count(*) from xpert_skill where xpert_id='11111111-1111-4111-8111-111111111111'" 3 "exact skill matches only"
check "select count(*) from xpert_skill" 4 "skills linked"
check "select id_last4 from xpert_restricted where xpert_id='11111111-1111-4111-8111-111111111111'" 7890 "card last four"
check "select (id_hash ~ '^[0-9a-f]{64}$')::text from xpert_restricted where xpert_id='11111111-1111-4111-8111-111111111111'" true "card hash"
check "select count(*) from xpert_restricted where id_hash like '%123456789%'" 0 "card number never stored"
check "select count(*) from xpert where phone = '0599'" 0 "duplicate phones imported without the phone"
check "select count(*) from employer" 1 "employer imported"

echo "apply again is a no-op"
node scripts/import-from-legacy.mjs --apply --existing-active-status=full_active | grep -q "already there 4"
check "select count(*) from xpert" 4 "no duplicates on repeat"
echo "IMPORT TESTS PASSED"
