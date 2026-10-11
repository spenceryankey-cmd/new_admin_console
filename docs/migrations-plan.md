# Migrations plan

## Ownership

One repo runs migrations for the shared database: this one, from `supabase/migrations`. The main site and the Railway backend read the schema and add nothing to it. Every file is additive (new tables, new nullable columns, new functions), is shown to the project owner before it runs, and is applied by the owner. No migration deletes or rewrites existing data.

Changes the other codebases must react to are listed per phase in the hand off note (`docs/FOR_JAMES.md`) so that release ships before or with the console change.

## Order

| Migration | Phase | Status | Adds | Changes existing tables |
| --- | --- | --- | --- | --- |
| 0001 staff, roles, audit | 1 | Written, tested, not applied | `staff_profile`, `role_permission`, `audit_log`, helper functions and triggers | None |
| 0002a Xpert screening tables | 2 | Written, tested, not applied | `status_history`, `guarantor`, `skill_evidence`, `reference_check`, `console_config`, bucket `xpert-evidence`, one new permission grant | None |
| 0002b Xpert status columns | 2 | Generated from the schema export (`scripts/generate-0002b.mjs`), tested on a stand in table | Status change function, links from the new tables | Xpert table: `xpert_status`, `account_active`, `activated_by`, `activated_at`, `verification_source` (existing rows keep access) |
| 0002c Xpert backfill | 2 | Same, run only after the preview is reviewed | None | Sets status for existing Xperts, copies guarantor details |
| 0003 requests, quotes, pricing, payments | 3 | Written, tested, not applied | `benchmark_rate`, `price_band`, `job_request`, `quote`, `payment`, three functions (send, withdraw, record the employer's answer), the quote validity setting, new permission grants | None. The link from the old task table is left for later, once the main site writes requests |
| 0004 jobs and dispatch | 4 | Written, tested, not applied | `job`, `assignment`, `change_order`, `recurring_service`, a trigger that creates a job when a payment is received, functions for dispatch, start, replace, confirm, cancel, change order confirm and reject, recurring generate; two new nullable columns on `payment` (`released_at`, `release_note`) and one on `job_request` (`recurring_id`); two pending settings; grants of `jobs.monitor` and `dispatch.match` | Only the two tables made in 0003. Nothing that existed before this project |
| 0004 dispatch | 4 | Planned | `assignment`, `change_order`, `recurring_service` | None |
| 0005 flags, feedback, coordinators | 5 | Planned | `flag`, `feedback`, `coordinator` | `notifications`: nullable `recipient_id` and read flag |

Table names follow your list. Column details for 0002 onward depend on the real schema.

## Conventions

- Names: snake_case, singular table names, as in your list.
- Every table: `created_at`, `updated_at`, `updated_by`, `change_reason`, an audit trigger, a delete blocker, RLS on.
- Statuses are text with a check constraint, so adding a status later is a small additive change.
- The state machine lives in `packages/shared` and is enforced by the API. A database check repeats the allowed values.
