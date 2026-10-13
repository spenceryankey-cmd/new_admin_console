# Migrations plan

## Ownership

This repo runs migrations for two databases. The console's own tables are in Supabase (`supabase/migrations`). The Xpert records, the employers and the service catalogue are in the hetzner Postgres database (`hetzner/migrations`). Ids that point from one to the other are plain text with no foreign key, and the console reports any that point at nothing. Every file is additive (new tables, new nullable columns, new functions), is shown to the project owner before it runs, and is applied by the owner. No migration deletes or rewrites existing data.

Changes the other codebases must react to are listed per phase in the hand off note (`docs/FOR_JAMES.md`) so that release ships before or with the console change.

## Order

| Migration | Phase | Status | Adds | Changes existing tables |
| --- | --- | --- | --- | --- |
| 0001 staff, roles, audit | 1 | Written, tested, not applied | `staff_profile`, `role_permission`, `audit_log`, helper functions and triggers | None |
| 0002a Xpert screening tables | 2 | Written, tested, not applied | `status_history`, `guarantor`, `skill_evidence`, `reference_check`, `console_config`, bucket `xpert-evidence`, one new permission grant | None |
| 0003 requests, quotes, pricing, payments | 3 | Written, tested, not applied | `benchmark_rate`, `price_band`, `job_request`, `quote`, `payment`, three functions (send, withdraw, record the employer's answer), the quote validity setting, new permission grants | None. The link from the old task table is left for later, once the main site writes requests |
| 0004 jobs and dispatch | 4 | Written, tested, not applied | `job`, `assignment`, `change_order`, `recurring_service`, a trigger that creates a job when a payment is received, functions for dispatch, start, replace, confirm, cancel, change order confirm and reject, recurring generate; two new nullable columns on `payment` (`released_at`, `release_note`) and one on `job_request` (`recurring_id`); two pending settings; grants of `jobs.monitor` and `dispatch.match` | Only the two tables made in 0003. Nothing that existed before this project |
| 0005 flags, feedback, coordinators | 5 | Written, tested, not applied | `coordinator`, `coordinator_xpert`, `flag`, `feedback`, the reliability views, flag functions | None |
| 0006 audit external ref | 7 | Written, tested, not applied | One unique index on `audit_log` | None |
| 0007 remove quote sign off | 7 | Written, tested, not applied | Nothing | Revokes the `quotes.signoff` grants (rows kept, `granted = false`) |
| 0008 primary and backup | 7B | Written, tested, not applied | `assignment.role`, `job.backup_xpert_id`, functions `job_set_backup`, `job_promote_backup`, `job_no_show`, two Pending settings, permission `dispatch.promote` | Replaces `job_dispatch` (now needs a backup), `job_replace` and `job_confirm`. Swaps the one active per job index for one per role. Adds status no_show to assignments |
| 0009 catalogue | 7C | Written, tested, not applied | `service_category`, `task_type` (10 and 40 rows, generated from `catalog/categories.json`), a trigger that refuses every insert, update, delete and truncate | None |
| 0010 category links and structured feedback | 7C | Written, tested, not applied | View `catalogue_mismatches`, `feedback.reasons`, `feedback.task_type_code`, a validation trigger on feedback | Five `category` columns get a NOT VALID foreign key to `service_category.label` (enforced for new rows and category changes, old rows untouched). `feedback` gets two columns |
| 0011 second factor | 7D | Written, tested, not applied | `staff_profile.mfa_enrolled_at`, `role_requires_mfa()`, `is_aal2()` | `has_permission()` and `is_active_staff()` are replaced (create or replace) so super admins and decision makers have nothing in the database until they have entered an authenticator code |
| 0012 inbox and notifications | 8 | Written, tested, not applied | `inbox_state` (handled or open, with a note), `notification_send` (a log of every send), three permissions (`inbox.read`, `inbox.handle`, `notifications.send`) and their role grants | None. The messages themselves and the bell notifications stay in the main site's database; the console only reads and writes through two ports |

The 0002b and 0002c migrations that were to be generated from a schema export no longer exist. They assumed the Xpert records were in Supabase. They are replaced by the hetzner migrations below and the import script.

### hetzner database

| Migration | Status | Adds |
| --- | --- | --- |
| 0001 catalogue and identity | Written, tested, not applied | Roles `console_read`, `console_write`, `backend_app`; `audit_log`; `service_category`; `task_type`; `xpert`; `xpert_restricted`; `xpert_skill`; `employer`; row level security, audit and hard delete blocks on all of them |
| 0002 seed catalogue | Written, tested, not applied | The 10 categories and 40 task types, generated from `catalog/categories.json` |
| 0003 Xpert status | Written, tested, not applied | `xpert_status_history`, `xpert_apply_transition` |
| 0004 Drop prison fields | Written, not applied | drops four columns from `xpert_restricted` |

## Conventions

- Names: snake_case, singular table names, as in your list.
- Every table: `created_at`, `updated_at`, `updated_by`, `change_reason`, an audit trigger, a delete blocker, RLS on.
- Statuses are text with a check constraint, so adding a status later is a small additive change.
- The state machine lives in `packages/shared` and is enforced by the API. A database check repeats the allowed values.
