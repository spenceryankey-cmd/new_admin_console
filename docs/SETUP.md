# Admin side setup

Everything here is done in the Supabase, Railway and Vercel dashboards. It takes about an hour once the schema export is in hand. Do the steps in order. Run `node --env-file=.env scripts/verify-setup.mjs` at the end of each part to see what is still missing. Never paste a key into chat, GitHub or email.

## Part 1. Supabase

1. **Confirm the project.** Open the production Supabase project that the Railway backend and the main site use. If the backend uses a different database, stop and tell the console team, because everything below assumes one shared database.

2. **Export the schema.** In SQL Editor, run each query in `docs/schema-export.sql` and send the results. They read definitions only, no row data. This fills in `scripts/xpert-schema.json` (table and column names) and the `XPERT_*` variables below.

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
   5. Copy `scripts/xpert-schema.example.json` to `scripts/xpert-schema.json`, fill it in from the schema export, then run `node scripts/generate-0002b.mjs scripts/xpert-schema.json`. It writes `0002b_xpert_status_columns.sql` and `0002c_xpert_backfill.sql` into `supabase/migrations`. Read both.
   6. Run `0002b`. After it runs, new Xpert registrations start as Applied with the account off, and existing Xperts keep their access.
   7. **Do not run `0002c` yet.** It classifies existing Xperts. Run its first block alone (the preview select), read the list, agree the cutover date, then run the rest.

5. **Create the first super admin.** In Authentication, Users, invite the person who will own the console, using an address no employer uses. Then edit the name and email in `supabase/seed/bootstrap_super_admin.sql` and run it in SQL Editor. It must run after the invite, because it looks the person up in the user list. They open the invitation email, choose a password, and sign in to the console. From the Staff screen they invite everyone else.

6. **Storage.** Migration 0002a creates a private bucket named `xpert-evidence`. Open Storage and check it shows as private. Do not add public policies.

7. **Keys.** In Project Settings, API, copy three values for the next parts: the project URL, the `anon` key (safe for the browser) and the `service_role` key (secret, API only).

## Part 2. Railway (the console API)

1. New service from the new repository. The root `railway.json` holds the build and start commands. No Dockerfile is needed.
2. Variables:

| Variable | Value |
| --- | --- |
| `SUPABASE_URL` | the project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | the `service_role` key |
| `WEB_APP_URL` | the console address, for example `https://admin.beyondxco.com` |
| `CORS_ORIGINS` | the same address, plus `http://localhost:5173` for local work |
| `XPERT_TABLE` | the Xpert table name from the schema export (required, no default) |
| `XPERT_ID_COLUMN`, `XPERT_NAME_COLUMNS`, `XPERT_PHONE_COLUMN`, `XPERT_CREATED_COLUMN` | the real column names. `XPERT_NAME_COLUMNS` can list several, for example `first_name,last_name` |
| `XPERT_AREA_COLUMN`, `XPERT_SKILLS_COLUMN` | optional, shown on the Xpert record |
| `XPERT_GUARANTOR_NAME_COLUMN`, `XPERT_GUARANTOR_CONTACT_COLUMN`, `XPERT_GUARANTOR_RELATIONSHIP_COLUMN` | where an applicant's guarantor is stored today. When set, the hourly sweep copies new ones into the guarantor queue |
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
- **The Xpert pipeline shows an error about a column:** an `XPERT_*` variable names a column that does not exist. `verify-setup` names the problem.
- **Rolling back a migration:** none of these migrations delete data. To undo 0002b, ask the console team for a reverse script rather than dropping columns by hand.
