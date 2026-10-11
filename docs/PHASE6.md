# Phase 6: hardening and tests

## What was added
- **Rate limiting.** The API refuses more than 600 requests a minute from one address (HTTP 429 with a `Retry-After`), never counting the health check. It sits behind one proxy on Railway, so the first forwarded address is used. Request bodies are capped at 200 KB.
- **No hard deletes through the API.** A test fails if any controller ever exposes a DELETE route. Combined with the database triggers, nothing can be removed from the console.
- **Every controller must be listed in the route test.** The route test now fails if a controller is added to the app module without being checked for access decorators.
- **Database structure checks** (`scripts/db/test_hardening.sql`). After all migrations it fails if any table in `public` has row level security off, is open to the anonymous role, can be written to by a signed in browser role, is missing the audit trigger, or can be hard deleted, or if any server function that changes data can be called from the browser. This covers tables added by future migrations too.
- **CI.** The workflow now has a `database` job that starts Postgres, applies every migration in order and runs all database tests, next to the existing type check, unit test, copy check and build job.
- **Runbook** for running the console: `docs/RUNBOOK.md`.

## Tests at this point
77 shared rule tests and 177 API tests (rules, services, routes, rate limit) plus the database scripts for migrations 0002a to 0005 and the hardening check.

## Still outstanding (not hardening, but decisions or outside this repo)
See "Open decisions" in `docs/RUNBOOK.md`.
