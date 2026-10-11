# What James needs to do

This is the list for whoever owns the BeyondX Supabase project, the Railway backend and the main site (jamesjnr1). It is ordered by when each item is needed. Items 1 to 5 unblock Phase 1 going live. Items 6 to 9 are needed before Phase 2 can be released.

Never paste keys into chat, GitHub or email. Set them directly in Railway and Vercel.

## Needed now (Phase 1)

1. **Tell us which database is shared.** Confirm whether the Railway backend uses the same Supabase Postgres project as the Vercel `/api` functions on the main site, and which project is production. The console reads and writes the same schema, so this decides everything after Phase 1.

2. **Export the schema.** Run the queries in `docs/schema-export.sql` in the Supabase SQL editor of the production project and send the results. They read table, column, key, policy and trigger definitions only, no row data. Phase 2 is built, and this export is what lets the last migration (0002b) be generated with the right names.

3. **Configure Supabase Auth for staff.**
   - Authentication, URL Configuration: add the admin console address as a redirect URL, for example `https://admin.beyondxco.com/set-password`.
   - Authentication, SMTP: set up custom SMTP (Resend works, the main site already uses it). The built in Supabase mailer is rate limited and unreliable for invitations.
   - Do not turn off email sign ups or email OTP. The main site uses `signInWithOtp` for employer email verification, and the console shares the same Auth user pool. The console is protected by the `staff_profile` table, not by closing sign ups, so employers cannot get in.
   - Optional but recommended: enable TOTP multi factor authentication.

4. **Review and run migrations 0001 and 0002a.** File: `supabase/migrations/0001_staff_roles_audit.sql`. It creates three new tables (`staff_profile`, `role_permission`, `audit_log`) and helper functions. It does not touch any existing table. It was tested on a local Postgres 16, including audit entries, blocked deletes and row level security. Run it once in the SQL editor after you have read it. Then run `supabase/migrations/0002a_xpert_screening.sql` (new tables only). Then invite the first super admin in Authentication and run `supabase/seed/bootstrap_super_admin.sql` (edit the name and email first) to create the first super admin. Use an email address that no employer on the main site uses.

5. **Deploy the console.**
   - Railway: new service from the new repo. The root `railway.json` holds the build and start commands. Variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WEB_APP_URL`, `CORS_ORIGINS`, `PORT` (see `.env.example`).
   - Vercel: new project from the new repo with the repo root as the root directory. The root `vercel.json` holds the build settings. Variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`.
   - DNS: point an admin subdomain (for example `admin.beyondxco.com`) at the Vercel project.
   - GitHub: add jamesjnr1 as a collaborator on the new repository.

## The admin side

The Supabase, Railway and Vercel steps are written out in `docs/SETUP.md`, and `node --env-file=.env scripts/verify-setup.mjs` checks them. Items 1 to 5 below are covered there. The part that only the backend owner can do is item 6, with the code pattern in `docs/BACKEND_CHANGES.md`.

## Needed before Phase 2 can be released

6. **Make the Railway backend respect Xpert approval.** Today an Xpert gets a token and a dashboard the moment they register. The new model needs the backend to check the Xpert's approval before doing anything useful for them. Phase 2 adds `xpert_status`, `account_active`, `activated_by`, `activated_at` and `verification_source` to the Xpert record. The backend must then:
   - set `account_active` to false and `xpert_status` to `applied` when a new Xpert registers;
   - refuse jobs, offers, push notifications and the dashboard unless `account_active` is true, and show a holding page such as "Your application is being reviewed";
   - leave Xperts out of `GET /api/workers`, the list employers can see, unless `account_active` is true.

   The console cannot do this part. Without it, the Approve button records the decision but does not stop anyone.

7. **Give the console team read access to the backend repo,** or at least the Xpert, task and employer models and the Xpert registration code. We inferred those fields from the main site and the old admin screens and need to confirm them.

8. **Existing Xperts.** Agree a cutover date. We will prepare a backfill that sets `full_active` for Xperts with a completed job and clean feedback and `provisional_active` for the rest, and move their guarantor details into the new guarantor table. You will be shown the list before it runs.

9. **Allow one extra column on `notifications`.** Phase 3 adds a nullable `recipient_id` so the existing bell can reach one employer or one Xpert. The main site's reads keep working because the column is nullable.

## Needed before the old admin is retired (Phase 6)

10. Rotate `ADMIN_PASSWORD`, then switch off the old `/admin` page and the `/admin/clear-data` and `/admin/clear-employers` routes. They hard delete records.
11. Re-enable phone verification at Xpert signup once Arkesel delivery works. It is switched off in the signup form today.
12. Stop emailing employer Ghana Card numbers in plain text and storing them in `support_messages`. Move them to a dedicated column that only named roles can read.

## Main site changes that come with later phases

These are for planning, not for now.

- Retire the Hire Workers flow and its dispatch and MoMo reference steps.
- Replace the task form with the request form: category, description, photos, location, timing and special requirements. Categories stay as they are.
- Add a quote screen where the employer can only accept or decline, and a payment step after acceptance.
- Release payment to the Xpert once both sides confirm the job is done.
- Replace the word worker with Xpert in all copy.
