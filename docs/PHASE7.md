# Phase 7: follow up round

This round has four phases. Each ends with what was built, what was skipped, what was assumed and the questions that remain. Phase 7A is described here. 7B to 7D are added as they are built.

## Decisions already made (not reopened)

1. Finance sign off for quotes above an Xpert's price band is not part of this product. `quotes.signoff` is removed (see docs/PHASE3.md). Quote composing stays with every role that can see the dashboard, finance included.
2. Every job gets a primary Xpert and a backup Xpert (Phase 7B).
3. The Xpert records live in a database called hetzner, not in the Supabase project this console was built against.
4. Service categories and task types never change. The console can never add, rename or remove one. Remote categories are no longer offered, so the list is the ten field categories and their forty task types.

## Phase 7A: where the Xpert records live

### What was found

The main site backend (`jamesjnr1/beyondx-backend`) is Express with Prisma on Postgres (`provider = "postgresql"`, the `pg` adapter, one `DATABASE_URL`). Its Xpert table was the quoted CamelCase `"Worker"`. Xperts sign in with a code and a PIN against the backend's own JWT, and employers have their own password hashes in the same database. Supabase is used by the main site only for employer email codes. The hetzner database is new and empty, so it is designed here instead of mapped.

### Where each kind of data lives now

| In hetzner (Postgres) | In Supabase (the console) |
| --- | --- |
| `xpert`, `xpert_status_history`, `xpert_skill`, `xpert_restricted`, `employer`, `service_category`, `task_type`, `audit_log` | staff and roles, `audit_log` (console copy), guarantor, evidence, reference checks, requests, quotes, payments, jobs, assignments, flags, feedback, coordinators, price bands, benchmarks, settings, the evidence storage bucket |

### The two hard problems

**Atomicity.** A status change and its history row must succeed or fail together. They now live in the same database, so `xpert_apply_transition` (hetzner migration 0003) locks the row, checks the expected old status, updates `xpert`, writes `xpert_status_history` and writes the hetzner audit row in one transaction. If it fails, nothing changed and the move is safe to retry, because it compares the expected old status. The console then copies the audit row into its own log with the hetzner row's unique key (`xpert_status:<history id>`), and a unique index (Supabase migration 0006) stops a second copy. If that copy fails, the status is already correct, and the hourly sweep copies any audit row from the last 48 hours that is missing. The hetzner history is the record of truth.

**Referential integrity.** No foreign key can span two databases, so every console table that holds an Xpert id (`guarantor`, `skill_evidence`, `reference_check`, `price_band`, `job`, `assignment`, `recurring_service`, `coordinator_xpert`, `flag`) holds it as plain text, as before. Four guards stand in for the missing key:

1. Every write path already checks the Xpert exists (`getXpert`) and the store treats a malformed id as not found.
2. The hourly sweep reads every Xpert id in those tables and reports any that do not exist in hetzner (`orphanedReferences` in the sweep result, and a warning in the log). It reads only and never deletes or edits.
3. The database blocks hard deletes on `xpert`, and the main backend is told never to delete one (docs/FOR_JAMES.md).
4. Inside hetzner, real foreign keys protect everything that is stored there (`xpert_skill`, `xpert_status_history` and `xpert_restricted` all point at `xpert`).

### Access control inside the database

Three group roles, one per caller. The reader (`console_read`) has column level `select` that excludes `pin_hash` and `password_hash`, and no access to `xpert_restricted`. The writer (`console_write`) can only execute `xpert_apply_transition`. The main backend (`backend_app`) can register and edit Xperts and employers, but cannot set the five status columns or delete anything. A trigger on `xpert` refuses a change to those columns unless the transition function (or the deliberate import) set a flag for that transaction, so even a mistaken grant cannot change status behind the console's back. Row level security is on for every table, every table has an audit trigger and a hard delete block, and the database tests check all of that.

### The smallest code change

The `XpertStore` interface stayed. The Xpert reads and the status move now go to a new `PostgresXpertRecords` class (`apps/api/src/hetzner`), which uses two `pg` connection pools: a reader and a writer. `ConsoleXpertStore` (formerly `SupabaseXpertStore`) delegates the Xpert record methods to it and keeps everything else on Supabase. No service or controller changed. The `XPERT_*` settings and `scripts/generate-0002b.mjs` are gone, replaced by `HETZNER_DATABASE_URL`, `HETZNER_WRITE_DATABASE_URL`, `HETZNER_SSL` and `HETZNER_CA_CERT`.

The `account_active` check the backend needs reads the same hetzner database, so approval takes effect with no deploy.

### Request form and quote response

The main site's request form and the employer's answer to a quote should reach the console's request and quote tables through a small API on the console (called server to server with a key kept in Railway variables), not by writing to Supabase directly. That API is not built yet: it is planned for after the ownership question below is answered.

### Catalogue

`catalog/categories.json` holds the ten categories and forty task types exactly as the live site lists them. `scripts/generate-catalog-seed.mjs` turns it into `hetzner/migrations/0002_seed_catalog.sql`. Codes are made mechanically from the labels (lowercase, ampersands dropped, other characters become one underscore, for example `skilled_trades` and `skilled_trades.carpentry_joinery`). `xpert_skill` points at these codes with real foreign keys, so an Xpert's skills cannot drift from the catalogue. The console's own copy of the catalogue and the foreign keys from `job_request.category` and `benchmark_rate.category` are Phase 7C.

### Import of existing Xperts and employers

`scripts/import-from-legacy.mjs` copies them from the previous backend's database. It is a dry run unless `--apply` is given. It keeps ids, is safe to repeat, skips coordinators, lists every skill value that does not match the catalogue exactly (nothing is guessed), never copies the Ghana Card number (last four characters and a keyed hash only), imports a phone number used twice without the phone so the unique check holds, and refuses to apply until you choose the status for existing active Xperts. Accounts that were switched off become Inactive.

## What this phase changed outside the database

- Supabase migration 0006 (audit external reference) and 0007 (revokes `quotes.signoff`).
- `quotes.signoff` removed from the shared package, role defaults, tests and docs. The README no longer says `quotes.compose` is held by no role.
- CI now runs the hetzner migrations and tests, the Postgres store against the hetzner schema, and the import test, in addition to the earlier checks.

## Still open

- Answered: the console owns requests, quotes, jobs, payments, feedback and coordinators. The main site will reach them through an intake API on the console, to be planned after 7C.
- Answered: prison and offense fields are dropped for good (hetzner migration 0004). `xpert_restricted` keeps only the Ghana Card type, last four characters and keyed hash.
- Answered: existing active Xperts are imported as provisionally active (`--existing-active-status=provisional_active`).
- Where hetzner runs relative to the console API (same Railway project, or elsewhere), which decides `HETZNER_SSL`.

## Phase 7B: primary and backup Xpert

Every job has a primary Xpert and a backup Xpert. The rules are in Supabase migration `0008_primary_backup.sql` (not applied), so a screen or a script cannot get around them.

- **Dispatch needs both.** `job_dispatch` takes a primary and a backup, which must be different Xperts. The old three argument function is dropped on purpose. The API also checks that both list the job's category and are active.
- **One Xpert, one place.** Database indexes allow one active primary and one active backup per job, and an Xpert cannot hold both. `job.backup_xpert_id` mirrors the backup for quick reads.
- **Replace the primary** works as before, leaves the backup in place, and cannot use the backup (use Promote backup).
- **Promote backup** (`dispatch.promote`, a reason is required). The backup becomes the primary. The old primary stays in the history as replaced. The Xpert confirmation is cleared. The job then shows **Backup needed** until one is added with **Make this Xpert the backup**.
- **No show** (`dispatch.promote`). The primary is recorded as a no show on the assignment. With a backup, the backup is promoted in the same transaction. With none, the job returns to Needs an Xpert. The database counts the Xpert's no shows inside the window.
- **Under Review.** When the count reaches the limit, the API moves the Xpert to Under Review with the existing `no_shows` trigger, through the one status function. The Xpert's status lives in the hetzner database, so that move cannot share the job's transaction. If it fails, the hourly sweep makes the same move (`noShowReviews` in the sweep result), so a missed review is repaired.
- **Settings, marked Pending:** `jobs.noShowWindowDays` (42, six weeks) and `jobs.noShowLimit` (2).
- **Completing a job** completes the primary and withdraws a backup that was never needed. Workload counts only primary assignments.
- **Existing live jobs** with no backup are not broken. They show Backup needed.

Permission `dispatch.promote` is granted to ops reviewers, decision makers and super admin. Finance does not hold it.
