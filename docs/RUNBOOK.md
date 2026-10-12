# Running the admin console

For whoever looks after the console day to day. Setup is in `docs/SETUP.md`; this is what to do afterwards.

## Every day
Open the dashboard. The numbers are the work: guarantors to confirm, evidence to review, new requests, quotes out, payments to record, jobs needing an Xpert, jobs needing attention, open flags. The hourly sweep keeps time based moves going (guarantor deadlines, expired quotes, due recurring services, promotions). If it looks stuck, Settings has a button to run it now.

## Who does what
Ops reviewers do the first pass work on screening, quoting, dispatch and monitoring. Decision makers approve Xperts, decide flags and decide Under Review, Suspended and Removed. Finance records MoMo payments. Super admins manage staff, roles and settings. Roles can be adjusted on the Roles screen.

## The payment loop in plain steps
1. Employer accepts the quote (or staff log it from a call). The system creates a payment waiting for MoMo.
2. Finance records the MoMo reference when the money arrives. That creates the job.
3. Ops dispatch an Xpert, mark the job started, and log each side's confirmation when it comes in.
4. When both have confirmed, the job completes and the payment shows as released. The console records state only. Finance makes the MoMo payout to the Xpert themselves.
5. Log feedback from the completed job. Good employer feedback counts towards the Xpert becoming fully active.

## Backups and rollback
- Turn on Supabase point in time recovery or daily backups for the project (Project Settings, Database, Backups). The console deletes nothing, so a backup is for disasters, not for undoing a click.
- Mistakes are corrected by a new action with a reason (replace the Xpert, withdraw the quote, move the status), never by deleting. Every change is in the Audit log with who, when and why.
- A migration is never edited after it has run. A fix is a new migration. No migration here drops data.
- To roll back a bad deploy, redeploy the previous build in Railway or Vercel. The database stays as it is; the migrations are additive so older code keeps working.

## Keys and access
- The `service_role` key lives only in Railway. If it is ever pasted anywhere else, rotate it in Supabase and update Railway at once.
- When someone leaves, make them inactive on the Staff screen the same day. Inactive staff cannot use the console even though their sign in still works.
- Keep at least two super admins so one person is never the only way in.

## Retiring the old admin
In this order, once the new console has been used for a full week with no problems:
1. Rotate `ADMIN_PASSWORD` on the old backend.
2. Switch off the old `/admin` page.
3. Remove `/admin/clear-data` and `/admin/clear-employers`. They hard delete records.
4. Check that nobody still has the old address bookmarked for daily use.
The backend owner makes steps 1 to 3 (see `docs/FOR_JAMES.md`, items 10 to 12).

## Open decisions
These are built as settings or working values, marked Pending in Settings, so they can change without a release.
- Evidence checklists and the reference call script (starter versions are in place).
- Where an Xpert goes when evidence fails.
- Whether Under Review keeps access to jobs.
- The gap after which an Xpert must reverify.
- How many reference calls before "unreachable" (working value 3) and how many clean jobs lift a provisional Xpert (working value 1).
- Whether the prison facility and offence level fields are shown to ops.
- Refund rules when a paid job is cancelled. Today the payment stays held and finance decides.
- Notifying the employer when a quote is ready and the Xpert when dispatched. This needs the `notifications.recipient_id` column agreed with the backend owner.
- The list of job categories, so benchmark rates and price bands line up with what Xperts list as skills.
- How many hours before a job is flagged as not started or waiting on a confirmation (working values 24 and 48).

## The hetzner database (Phase 7A)

The Xpert records, their status history and the service catalogue are in the hetzner Postgres database. The console reaches it with two users, so a problem is usually one of these.

- **Every Xpert screen fails with a database error.** Run `node --env-file=.env scripts/verify-setup.mjs`. It tells you whether the reader connects, whether the tables exist and whether `HETZNER_SSL` matches where the database runs. On Railway's private network use `disable`. Anywhere public use `require`.
- **A status change fails with "The status changed".** Someone else moved that Xpert first. Reload and try again. Nothing was changed.
- **A status change fails with a permission error.** The writer user must be created in the `console_write` role and nothing else. Re-run Part 1b of `docs/SETUP.md`.
- **The hourly sweep result shows `orphanedReferences` above 0.** Some console record points at an Xpert id that does not exist in hetzner (a typo, or an Xpert row that was removed). The log lists the table and id. Nothing is deleted automatically. Fix the id by hand or tell the console team.
- **The sweep result shows `auditCopied` above 0.** The console copied a status change into its audit log that it had missed. That is the repair working. A number that is above 0 every hour means the copy is failing: check the API logs.
- **A new Xpert registered but cannot sign in to work.** That is correct until they are approved in the console. The database starts every new Xpert as Applied with the account off.
- **Never** edit `xpert_status` or `account_active` directly in the database. A trigger refuses it. Use the console, which records who changed it and why.
