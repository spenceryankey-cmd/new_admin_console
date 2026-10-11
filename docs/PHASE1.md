# Phase 1 report: foundation

## Built

- Monorepo with npm workspaces, TypeScript everywhere, CI (typecheck, tests, copy check, build).
- `packages/shared`: roles, a catalogue of 26 permissions with plain language labels, default grants per role, input schemas, shared response types. 12 tests, including one that proves the migration seed matches the defaults.
- `apps/api` (NestJS): sign in verification, active staff check, permission guard that refuses undeclared routes, staff invite and update, role permission editor, audit log reader, sign in recording, health check. Fails fast on bad configuration. 18 tests on the guards, the staff safety rules and the environment check.
- `apps/web` (React): sign in, forgot password, set password for invitations, responsive shell with a menu that only shows what the person's role allows, Staff, Roles and Audit log screens, a dashboard that shows the person's access, placeholder screens for every later module, offline banner, installable app with a small service worker for the shell.
- Migration `0001_staff_roles_audit.sql`: three new tables, audit trigger, delete blocker, append only audit log, row level security, seed of default grants. Tested against a local Postgres 16.
- Bootstrap script for the first super admin. Hand off note for the Supabase and Railway owner.

## Verified

- Typecheck, unit tests, production build and the copy check all pass.
- Migration behaviour on Postgres 16: seed produces no audit noise; inserts and updates are audited with actor and reason; deletes and audit edits are blocked; an employer account sees nothing; browser roles cannot write; anon cannot read.
- API started locally: health answers, every other route returns 401 without a token, bad configuration stops startup.
- Web app walked through in a real browser against a mock backend, on desktop and phone widths, with no console errors.

## Not verified, and why

- The API has not run against a real Supabase project. No project keys were available. The first live run should be the invite and sign in flow in a test project.
- Email delivery of invitations depends on the Supabase SMTP setup.

## Skipped on purpose

- Anything touching Xperts, jobs, quotes or employers. Those need the real schema (see `docs/FOR_JAMES.md`, items 1, 2 and 7).
- Multi factor authentication in the console. Supabase supports it, we can switch it on after launch.
- Offline write queue. Reads show the last good data while offline, writes are never queued silently.

## Assumptions to confirm

- Default role grants are a first pass: ops reviewers can read quotes but not compose them; finance approvers can sign off but not compose; only decision makers can approve Xperts or decide Under Review, Suspended and Removed. The Roles screen lets a super admin change any of this without a release.
- One permission, `quotes.compose`, covers preparing and sending a quote.
- Email addresses already used by an employer on the main site cannot be used for staff. The invite refuses them with a clear message.
- Deactivating a staff member takes effect on their very next request.
- The last active super admin cannot be demoted or deactivated, and nobody can change their own role.
- Staff sign in is audited once per browser session.

## Next: Phase 2

Xpert pipeline, guarantor queue, evidence queue, reference queue, approval and the state machine. Needs the schema export first. The first Phase 2 migration to show you will add the status columns to the Xpert record plus `status_history`, `guarantor`, `skill_evidence` and `reference_check`.
