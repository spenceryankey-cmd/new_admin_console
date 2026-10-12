# BeyondX Admin Console

Operations console for BeyondX staff. It runs the closed loop model: Xperts apply and are screened here, employers post requests, staff quote, match, dispatch and monitor.

Status: **Phase 6 of 6 built** (foundation, Xpert screening, requests and quotes, jobs and dispatch, flags and reliability, hardening). Nothing has been run against the real database yet: see `docs/SETUP.md`. See `docs/PHASE1.md` to `docs/PHASE6.md` for what exists in each phase, `docs/SETUP.md` for the admin side setup, and `docs/FOR_JAMES.md` for what the Supabase and Railway owner must do.

## Layout

```
apps/api            NestJS API (Railway). Checks sign in, role and permission on every request.
apps/web            React, Vite, Tailwind app (Vercel). Responsive, installable, shows loading, empty and error states.
packages/shared     Roles, permissions, input schemas and shared types. Imported by api and web.
supabase/migrations Additive SQL only, numbered. Nothing runs automatically.
supabase/seed       One off scripts, for example the first super admin.
docs                Plans, hand off notes, schema export queries.
hetzner             Migrations and tests for the hetzner Postgres database, which holds the Xpert records (hetzner/migrations).
catalog             The service categories and task types, exactly as the live site lists them (catalog/categories.json).
scripts             Repo checks (copy rules), verify-setup, the catalogue seed generator, the one off import from the previous backend, database test helpers (scripts/db).
```

## Run it locally

```
npm install
cp .env.example .env     # fill in; apps read their own variables, see below
npm run dev:api          # http://localhost:3000
npm run dev:web          # http://localhost:5173
```

Checks: `npm run typecheck`, `npm test`, `npm run lint:copy`, `npm run build`.
Try the screens without Supabase: `npm run dev:mock -w @beyondx/api` runs the real API code against sample data (development only).
Test migrations on a local Postgres: `scripts/db/test-migrations.sh` (Supabase side) and `scripts/db/test-hetzner.sh hetzner/tests/test_hetzner.sql` (hetzner side). `scripts/db/test-hetzner-store.sh` runs the API's Postgres store against the hetzner schema, and `scripts/db/test-import.sh` tests the import.
Check a live setup: `node --env-file=.env scripts/verify-setup.mjs`.

API variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WEB_APP_URL`, `CORS_ORIGINS`, `PORT`, `HETZNER_DATABASE_URL`, `HETZNER_WRITE_DATABASE_URL` and `HETZNER_SSL` (see `.env.example`). The Xpert records are in the hetzner database, not in Supabase. The API refuses to start if a required one is missing.
Web variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`. The service role key never goes in the web app.

## How access works

1. Staff sign in with Supabase Auth (individual accounts, no shared password).
2. The API verifies the token, then requires an active row in `staff_profile`. Employers and Xperts who have a Supabase account on the main site get nothing.
3. Every route must declare who may call it (`@Public`, `@AnyStaff` or `@RequirePermissions`). A route with no declaration is refused.
4. Row level security repeats the check in the database, so a leaked browser session still cannot read or write beyond its role.
5. `super_admin` can edit what each role may do on the Roles screen. `quotes.compose` (preparing and sending quotes) is held by every role that can see the dashboard, including finance. There is no finance sign off step for quotes above a price band; that was removed on purpose.

## Rules every new table follows

- Never hard delete. A trigger blocks it. Use an inactive flag or a status.
- `updated_by` and `change_reason` columns, set by the API.
- An audit trigger (`audit_row_change`) writes before and after values to `audit_log` in the same transaction, so a change cannot happen without a record.
- Row level security on, with access decided by `has_permission('...')`.
- Migrations are additive and are shown to the project owner before they run.

## House rules for text on screen

People who do the work are called Xperts, never workers. No em dashes, en dashes or spaced hyphens as punctuation. `npm run lint:copy` enforces this in CI.
