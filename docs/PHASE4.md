# Phase 4: job board and dispatch

## What exists
- **A job is created for you.** When finance records an employer's MoMo payment as received, the database creates the job (one per request, never twice).
- **Job board** (`/jobs`): all jobs with status and search, a Needs attention tab, and a Recurring services tab.
- **Matching.** A job shows active Xperts (provisionally or fully active, account active) who list the job's category as a skill, best fit first. Fit counts price band (within, above, below, none), same area, fully active over provisional, and current workload. Nobody is hidden for a poor fit, only for being unable to take the job at all.
- **Dispatch, start, replace, cancel.** Replacing needs a reason, keeps the old assignment in the history, and clears the old Xpert's confirmation.
- **Completion.** The employer and the Xpert each confirm. When both have, the job completes and the payment is marked released. The console records state only: the MoMo payout itself is finance's job.
- **Monitoring.** A job is flagged when it has not started a set number of hours after dispatch, or has waited too long for the second confirmation. Both thresholds are in Settings storage as pending (24 and 48 hours until decided).
- **Change orders** (`/change-orders`): logged against a job with an Xpert on it; confirmed only when both sides confirm; one rejection ends it.
- **Recurring services**: a standing request that creates a new request each time it comes due. The hourly sweep creates due ones, and staff can create one by hand.
- **Dashboard** shows job counts.

## Who can do what
Monitoring is visible to ops, decision makers, finance and super admin. Dispatch, start, confirm and cancel need `dispatch.match` (ops, decision maker, super admin). Replace needs `jobs.replace`. Change orders need `changeorders.manage`. Recurring services use `quotes.compose`.

## Assumed (change if wrong)
- Cancelling a job leaves the payment as received. Refund rules are still open.
- Employer and Xpert confirmations are logged by staff for now (the main site can call the same functions later).
- Only a job in progress can be confirmed.

## Not built here
- Notifying the Xpert on dispatch (needs the notifications table decision, see `FOR_JAMES.md`).
- Linking jobs to coordinators: Phase 5.
