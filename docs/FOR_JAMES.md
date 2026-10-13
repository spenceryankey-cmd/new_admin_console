# What James needs to do

This is the list for whoever owns the BeyondX Supabase project, the Railway backend and the main site (jamesjnr1). Read `docs/PHASE7.md` first: the Xpert records now live in a Postgres database called hetzner, not in Supabase.

Never paste keys into chat, GitHub or email. Set them directly in Railway and Vercel.

## Needed now

1. **Create the hetzner database and its three users.** Run `hetzner/migrations` in order as the owner, then create `console_reader`, `console_writer` and `backend_user` (the exact commands are in `docs/SETUP.md`, Part 1b). Tell the console team where it runs: in the same Railway project and environment as the console API (then use the private address and `HETZNER_SSL=disable`), or somewhere else (then the public address, SSL, and an allow list).

2. **Point the main backend at hetzner as `backend_user`,** and make the small changes in `docs/BACKEND_CHANGES.md`: registration stops setting any status, every Xpert route refuses an Xpert whose `account_active` is false, and the employer facing list shows only active Xperts. The console cannot do this part. Without it, the Approve button records the decision but does not stop anyone.

3. **Do not run `prisma migrate` or `prisma db push` against hetzner.** The console owns those migrations. Use `prisma db pull` and map the models with `@@map`.

4. **Copy the existing Xperts and employers.** Run `scripts/import-from-legacy.mjs` as a dry run first, read its report, then apply it. It keeps ids and skips coordinators, and it lists every skill that does not match the catalogue exactly so you can fix them by hand. Decide, before applying, whether existing active Xperts become provisionally or fully active.

5. **Never hard delete an Xpert row.** The console's records point at Xpert ids with no foreign key across the two databases, so a deleted row would leave orphans. The database blocks hard deletes on its own tables. Soft delete with `deleted_at`.

6. **Sensitive fields.** `prisonFacility`, `offenseLevel`, `offenseNotes` and `releaseDate` are dropped for good, so the main site can stop collecting them. The Ghana Card number is no longer on the Xpert record. It moves to a restricted table that the console cannot read, and the card number is stored only as its last four characters plus a keyed hash. The backend must never return them to a browser (the masked last four only).

7. **Skills and categories.** The console only accepts a request, recurring service, benchmark or price band whose `category` is exactly one of the ten labels in `catalog/categories.json` (for example `Facility & Cleaning`). Whatever the main site sends to the console must use those exact labels. The registration screens must offer only the codes in `service_category` and `task_type` (10 categories, 40 task types, field work only). Remote categories are gone. The catalogue is read only for everyone.

8. **Allow one extra column on `notifications`.** Phase 3 adds a nullable `recipient_id` so the existing bell can reach one employer or one Xpert. The main site's reads keep working because the column is nullable.

9. **Supabase settings for the console's sign in (Phase 7D).** Nothing on the main site changes. (a) In Supabase, Authentication, Sign In / Providers, make sure multi factor with an authenticator app (TOTP) is enabled. (b) In Settings, JWT Keys, switch the project to asymmetric signing keys. The console API checks tokens itself with the public keys and does not accept the old shared secret. Employers and Xperts signing in on the main site keep working, because their tokens are signed by the same project and the main site does not depend on which kind of key signs them. Check this with a test sign in on the main site after switching.

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
