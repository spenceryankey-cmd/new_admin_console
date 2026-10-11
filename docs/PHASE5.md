# Phase 5: flags, feedback, reliability, coordinators, dashboard, settings

## What exists
- **Flags and counter flags** (`/flags`). Anyone with `flags.raise` (ops and decision makers) raises a flag against an Xpert, optionally tied to a job. The employer's or the Xpert's side is added as a counter flag before a decision. Decision makers start an investigation and then uphold or dismiss with a written note. Deciding closes the attached counter flags. An upheld flag can send the Xpert to Under Review in the same step, using the status rules (safety, no show or named incident as the trigger).
- **Feedback** (`/feedback`). Logged from a completed job, one per side per job: rating 1 to 5, on time, would use again, comment.
- **Reliability record.** Shown on each Xpert's record and on the flag page. Computed from jobs, feedback and flags by a database view. Nothing is typed in by hand.
- **Clean jobs promote Xperts.** A job is clean when it is completed, the employer rated it 4 or more, it was not marked late, and no flag on that job was upheld. When a provisional Xpert reaches the configured number of clean jobs (working value 1, pending), they become fully active automatically, with the reason in the status history. The same check runs in the hourly sweep.
- **Coordinators** (`/coordinators`). Add coordinators and put Xperts on their team (one coordinator per Xpert, history kept). Team metrics (people, active, jobs live and done, clean jobs, average rating, flags upheld) are computed from the roster's records.
- **Dashboard** shows open flags and feedback this week.
- **Settings** now includes the two job monitoring thresholds. Benchmark rates stay on the Pricing page.

## Assumed (change if wrong)
- A clean job needs an employer rating of 4 or more. Xpert side feedback is kept but does not count.
- "On time not said" does not stop a job being clean.
- Ops can see flags (to follow what they raised) but cannot decide them.
- Coordinator jobs are quoted by staff like any other; a request can carry a coordinator id (set by the main site or later by staff), and the job inherits it.

## Not built here
- Notifying people of a decision (needs the notifications table decision, see `FOR_JAMES.md`).
- Reverification after a gap and the failed evidence exit status: still waiting on decisions.
