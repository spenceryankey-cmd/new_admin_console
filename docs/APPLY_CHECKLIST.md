# Apply checklist: Phases 7A to 8

Nothing from 7A to 8 has been run on a real database yet. This is the order to do it in. Tick each box as you go. Credentials go only into Railway and Supabase, never into chat, GitHub or email.

Migrations 0001 to 0007 of the console are assumed to be applied already. Check first (step 2.1).

## 0. Before you start

- [ ] Take a backup. Supabase: Database, Backups, make sure one exists from today. Railway: take a snapshot of the main Postgres.
- [ ] Pick a quiet time. No one should be using the old admin or the console while steps 2 and 3 run.
- [ ] Have the GitHub repo open on the latest `main` (CI must be green).
- [ ] **Sign in to the console once now, as yourself, and keep that browser open.** You will need it in step 3.

## 1. hetzner database (Railway Postgres, the Xpert records)

Run each file in order, as the database owner. Read each one before you run it. Stop at the first error and do not carry on.

- [ ] 1.1 Create the database `hetzner` in the same Railway project as the console API (private address, `HETZNER_SSL=disable`) or elsewhere (public address, `HETZNER_SSL=require`, plus an allow list).
- [ ] 1.2 `hetzner/migrations/0001_catalog_identity.sql`
- [ ] 1.3 `hetzner/migrations/0002_seed_catalog.sql`
- [ ] 1.4 `hetzner/migrations/0003_xpert_status.sql`
- [ ] 1.5 `hetzner/migrations/0004_drop_prison_fields.sql` (drops four columns that are not used any more)
- [ ] 1.6 Create the three users with the commands in `docs/SETUP.md`, Part 1b: `console_reader`, `console_writer`, `backend_user`. Use long random passwords.
- [ ] 1.7 Check: `select count(*) from service_category;` gives 10 and `select count(*) from task_type;` gives 40.
- [ ] 1.8 Check: connected as `console_reader`, `select * from xpert_restricted;` must fail with permission denied.
- [ ] 1.9 In Railway, on the console API service, set `HETZNER_DATABASE_URL` (console_reader), `HETZNER_WRITE_DATABASE_URL` (console_writer) and `HETZNER_SSL`. Optional: `HETZNER_CA_CERT`.

## 2. Supabase (the console tables)

- [ ] 2.1 Check what is applied. In the SQL editor: `select to_regclass('public.assignment'), to_regclass('public.feedback'), to_regclass('public.staff_profile');` All three must exist. If any is missing, stop and ask.
- [ ] 2.2 Switch the project to **asymmetric JWT signing keys**: Settings, JWT Keys. The console API accepts only those. Until this is done, every token is refused.
- [ ] 2.3 Authentication, Multi-factor: make sure **authenticator app (TOTP)** is enabled.
- [ ] 2.4 After 2.2, sign in on the main site as a test employer to confirm it still works. Stop if it does not.

Then the migrations, in order. Read each file before running it. Each one is wrapped in a transaction, so a failure leaves nothing half done.

- [ ] 2.5 `supabase/migrations/0008_primary_backup.sql` (every job gets a primary and a backup Xpert)
- [ ] 2.6 `supabase/migrations/0009_catalogue.sql` (the 10 categories and 40 task types, read only)
- [ ] 2.7 `supabase/migrations/0010_catalogue_links_feedback.sql` (category links on new rows, structured feedback)
- [ ] 2.8 Check: `select * from catalogue_mismatches;` Rows here are old jobs, requests, rates or price bands whose category is not one of the ten. They are reported, not changed. Review them with the team. Once the list is empty, you can validate the links (see the end of 0010).

**Do not run 0011 yet.** Do step 3 first.

## 3. Your own authenticator app, then 0011

0011 makes super admins and decision makers need an authenticator code inside the database too. If you run it before you have set one up, you can lock yourself out.

- [ ] 3.1 Deploy the new console API and web app (Railway and Vercel, latest `main`). The API starts only if all variables are set.
- [ ] 3.2 Sign in to the new console as a super admin. You will be shown the authenticator set up screen. Scan the code, enter the 6 digit code, confirm.
- [ ] 3.3 Sign out and in again. You must now be asked for a code. Enter it. You should reach the console.
- [ ] 3.4 Do the same for every other super admin and decision maker. Keep at least two super admins.
- [ ] 3.5 Now run `supabase/migrations/0011_mfa.sql`.
- [ ] 3.6 Sign out and in again, with the code. The console must still work. If it does not, tell me the exact message before doing anything else.
- [ ] 3.7 Now run `supabase/migrations/0012_inbox_notifications.sql` (the Support inbox and Send a notification tables). The two pages will say "not connected" until the main site link is made (see `docs/PHASE8.md`). Nothing else depends on it.

## 4. Import the existing Xperts and employers

- [ ] 4.1 Read the header of `scripts/import-from-legacy.mjs`.
- [ ] 4.2 Dry run: `node scripts/import-from-legacy.mjs --existing-active-status=provisional_active` with the old database read only connection in your environment. Read the report: skills that did not match the catalogue, and phone numbers used twice.
- [ ] 4.3 Fix what the report lists, by hand.
- [ ] 4.4 Apply the import. Run it again: the second run must change nothing.
- [ ] 4.5 In hetzner: `select status, count(*) from xpert group by 1;` Existing active Xperts should be `provisional_active`.

## 5. Check the whole setup

- [ ] 5.1 `node --env-file=.env scripts/verify-setup.mjs` must end with "Everything checked is in place." Anything marked FAIL says what to fix.
- [ ] 5.2 Open the console and try: a request, a quote, a payment, dispatching a job with a primary and a backup, logging feedback with a task type and reasons.
- [ ] 5.3 In the Audit log, confirm those actions are recorded with your name.
- [ ] 5.4 Check the hourly sweep ran: Look in the API logs for the sweep line. Orphaned references should be zero.

## 6. If something goes wrong

- Do not edit a migration that has run. A fix is a new migration.
- To undo a bad API or web deploy, redeploy the previous build in Railway or Vercel. The migrations are additive, so older code keeps working, except that older code cannot dispatch a job without the required backup.
- If you are locked out by 0011: in Supabase, Authentication, Users, find yourself, Factors, remove the authenticator factor, and set it up again at the next sign in. If the only super admin is locked out, do this as the project owner.
- Send me the exact error message and which step you were on.

## Still open (not blocking)

- Wording of the nine feedback reasons.
- Whether evidence task types should be limited to the 40.
- Whether to validate the category links once `catalogue_mismatches` is empty.
- Whether ops should be notified when the no show rule sends an Xpert to Under Review.
- Whether two no shows in six weeks is final (both numbers are Pending settings).
