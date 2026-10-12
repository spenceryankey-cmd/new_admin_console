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

The 0002b and 0002c migrations that were to be generated from a schema export no longer exist. They assumed the Xpert records were in Supabase. They are replaced by the hetzner migrations below and the import script.

### hetzner database

| Migration | Status | Adds |
| --- | --- | --- |
| 0001 catalogue and identity | Written, tested, not applied | Roles `console_read`, `console_write`, `backend_app`; `audit_log`; `service_category`; `task_type`; `xpert`; `xpert_restricted`; `xpert_skill`; `employer`; row level security, audit and hard delete blocks on all of them |
| 0002 seed catalogue | Written, tested, not applied | The 10 categories and 40 task types, generated from `catalog/categories.json` |
| 0003 Xpert status | Written, tested, not applied | `xpert_status_history`, `xpert_apply_transition` |

## Conventions

- Names: snake_case, singular table names, as in your list.
- Every table: `created_at`, `updated_at`, `updated_by`, `change_reason`, an audit trigger, a delete blocker, RLS on.
- Statuses are text with a check constraint, so adding a status later is a small additive change.
- The state machine lives in `packages/shared` and is enforced by the API. A database check repeats the allowed values.
