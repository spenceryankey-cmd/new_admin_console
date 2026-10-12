# Admin side setup

Everything here is done in the Supabase, Railway and Vercel dashboards, plus one Postgres database called hetzner that holds the Xpert records. Do the steps in order. Run `node --env-file=.env scripts/verify-setup.mjs` at the end of each part to see what is still missing. Never paste a key into chat, GitHub or email.

## Part 1. Supabase

1. **Confirm the project.** The console's own tables (staff, requests, quotes, jobs, flags, feedback, screening) live in one Supabase project. The Xpert records do not: they live in the hetzner database (Part 1b). Staff sign in through this Supabase project. The main site's Xperts and employers do not sign in through it.

3. **Authentication settings** (Authentication in the left menu).
   - URL Configuration: set Site URL to the console address, for example `https://admin.beyondxco.com`. Add `https://admin.beyondxco.com/set-password` to Redirect URLs. Keep the main site's existing redirect URLs.
   - SMTP Settings: turn on custom SMTP and use Resend (the main site already sends with it). The built in mailer is rate limited and often fails for invitations.
   - Providers, Email: leave **sign ups on** and leave **confirm email on**. Employers sign up on the main site through the same user pool. The console is protected by the `staff_profile` table, so an employer who signs in gets nothing here.
   - Optional: Multi Factor, turn on TOTP.

4. **Run the migrations, in order, in SQL Editor.** Read each file first. Each one is additive: new tables, new columns, new functions, nothing dropped.
   1. `supabase/migrations/0001_staff_roles_audit.sql`
   2. `supabase/migrations/0002a_xpert_screening.sql`
   3. `supabase/migrations/0003_requests_quotes_pricing.sql` (new tables only: requests, quotes, pricing, payments). It can run before or after the next step, since it does not touch the Xpert table.
   4. `supabase/migrations/0004_jobs_dispatch.sql` and then `supabase/migrations/0005_flags_feedback_coordinators.sql` (jobs, dispatch, change orders, recurring services, flags, feedback, coordinators). New tables only, apart from three small nullable columns on tables the console itself created in 0003 and 0004. Both can run before or after the Xpert table steps below.
   5. `supabase/migrations/0006_audit_external_ref.sql` (one unique index so a hetzner audit row is never copied twice) and `supabase/migrations/0007_remove_quote_signoff.sql` (revokes the unused finance sign off permission; it revokes rows and deletes nothing).

5. **Create the first super admin.** In Authentication, Users, invite the person who will own the console, using an address no employer uses. Then edit the name and email in `supabase/seed/bootstrap_super_admin.sql` and run it in SQL Editor. It must run after the invite, because it looks the person up in the user list. They open the invitation email, choose a password, and sign in to the console. From the Staff screen they invite everyone else.

6. **Storage.** Migration 0002a creates a private bucket named `xpert-evidence`. Open Storage and check it shows as private. Do not add public policies.

7. **Keys.** In Project Settings, API, copy three values for the next parts: the project URL, the `anon` key (safe for the browser) and the `service_role` key (secret, API only).

## Part 1b. The hetzner database (Xpert records)

1. **Where it runs.** If hetzner is a Postgres service in the same Railway project and environment as the console API, use its private address (the host ends in `.railway.internal`) and set `HETZNER_SSL=disable`. The database is then never exposed to the internet. If it is anywhere else, use the public address with `HETZNER_SSL=require`, and a firewall rule or the provider's allow list so only the console API and the main backend can connect.
2. **Run the migrations, in order, as the database owner**, reading each first: `hetzner/migrations/0001_catalog_identity.sql`, `0002_seed_catalog.sql`, `0003_xpert_status.sql`. They create new tables, three group roles and one function. Nothing existing is changed.
3. **Create the three login users yourself** (so no password is ever in a file). Pick long random passwords and keep them only in Railway variables:

   ```sql
   create user console_reader login password '...' in role console_read;
   create user console_writer login password '...' in role console_write;
   create user backend_user   login password '...' in role backend_app;
   ```
4. **Set the variables** `HETZNER_DATABASE_URL` (console_reader), `HETZNER_WRITE_DATABASE_URL` (console_writer) on the console API, and give the main backend its own connection as `backend_user`.
5. **Existing Xperts and employers** are copied from the previous backend's database by `scripts/import-from-legacy.mjs`. Read its header, run it once as a dry run, check the report (it lists every skill that did not match the catalogue and every phone used twice), then apply it. Choose the status of existing active Xperts with `--existing-active-status`. There is deliberately no default, because it is a business decision.
6. Run `node --env-file=.env scripts/verify-setup.mjs`. It checks the catalogue (10 categories, 40 task types), that the reader cannot read PIN hashes or the restricted table, and that the writer can do nothing except run the status function.

## Part 2. Railway (the console API)

1. New service from the new repository. The root `railway.json` holds the build and start commands. No Dockerfile is needed.
2. Variables:

| Variable | Value |
| --- | --- |
| `SUPABASE_URL` | the project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | the `service_role` key |
| `WEB_APP_URL` | the console address, for example `https://admin.beyondxco.com` |
| `CORS_ORIGINS` | the same address, plus `http://localhost:5173` for local work |
| `HETZNER_DATABASE_URL` | connection string for the read only user (Part 1b). Required |
| `HETZNER_WRITE_DATABASE_URL` | connection string for the writer user, which can only run the status transition function. Required, and it must be a different user |
| `HETZNER_SSL` | `require` (default, checks the server certificate), or `disable` on Railway's private network inside one project |
| `HETZNER_CA_CERT` | optional PEM of the certificate authority, with `\n` for new lines |
| `SWEEPS_ENABLED` | `true` (default). The sweep closes applications after the guarantor deadline and starts the guarantor clock |

3. Generate a public domain for the service and note it. That is `VITE_API_URL` in Part 3.
4. After the deploy, check `https://YOUR-API/health` returns `{"ok":true}`.

## Part 3. Vercel (the console web app)

1. New project from the new repository. Leave the root directory as the repo root. The root `vercel.json` holds the install and build commands.
2. Variables (these are exposed in the browser by design):
   - `VITE_SUPABASE_URL`: the project URL
   - `VITE_SUPABASE_ANON_KEY`: the `anon` key. Never the `service_role` key.
   - `VITE_API_URL`: the Railway domain from Part 2
3. Domains: add `admin.beyondxco.com` (or your choice) and create the DNS record Vercel shows. Make sure the address matches `WEB_APP_URL` and the Supabase redirect URL.

## Part 4. Check it

1. Put the Part 2 variables in a local `.env` (it is git ignored) and run `node --env-file=.env scripts/verify-setup.mjs`. Add `API_URL=https://YOUR-API` to include the deployed API. Fix any FAIL line, then run it again.
2. Open the console, sign in as the super admin, and invite one more staff member. Confirm the invitation email arrives and the link opens the set password page.
3. Open Settings and look at the pending items. They are working values, not decisions. Change the ones you have decided.
4. Walk the whole loop once with test data: add a request, send a quote, log the employer's acceptance, record the MoMo payment, and watch a job appear on the Job board. Dispatch an active Xpert, mark it started, log both confirmations, then log feedback. Each step is on screen with a reason where one is needed.
5. Add one test Xpert through the main site (or a test row) and watch it appear in the Xpert pipeline as Applied, then in the guarantor queue after the next sweep. Run the sweep at once from Settings if you do not want to wait an hour.

## Part 5. Make the main backend respect approval

Until this is done the Approve button records a decision but does not stop anyone. Follow `docs/BACKEND_CHANGES.md`.

## If something goes wrong

- **Every request fails with a CORS message in the browser:** `CORS_ORIGINS` does not include the exact console address, with `https://` and no trailing path.
- **"This account is not set up for the admin console":** the person signed in but has no row in `staff_profile`. Invite them from Staff, or run the bootstrap script for the first admin.
- **Invitation emails never arrive:** SMTP is not set up, or the sender domain is not verified in Resend.
- **The Xpert pipeline shows a database error:** run `verify-setup`. It checks both hetzner connections, the tables, and that the reader cannot see secrets.
- **Rolling back a migration:** none of these migrations delete data. To undo 0002b, ask the console team for a reverse script rather than dropping columns by hand.
