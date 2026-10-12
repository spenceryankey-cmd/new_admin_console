# Changes the main backend needs

The main backend is the Express and Prisma service in `jamesjnr1/beyondx-backend`. Today it uses its own Postgres database through `DATABASE_URL`. The Xpert records are moving to a new Postgres database called hetzner, and the console owns Xpert approval there. This page is what the backend must do to work with it. It was written from reading that repo, so file names and line references are real, but they are a snapshot: check them against the current code.

## What changes underneath

- The tables are lowercase `snake_case` (`xpert`, `employer`, `xpert_skill`, `service_category`, `task_type`), not Prisma's quoted `"Worker"` and `"Employer"`. The old Worker model is now `xpert`, and `workerId` is `xpert_code`.
- The backend connects to hetzner as its own database user, `backend_user`, which belongs to the `backend_app` role. That role can register and edit Xperts and employers. It cannot set the five status columns (`xpert_status`, `account_active`, `activated_by`, `activated_at`, `verification_source`), and it cannot delete anything. The database enforces this, so a bug cannot break it.
- Xperts still sign in with their code and PIN, and employers with email and password, against the backend's own JWT. Nothing about login moves to Supabase.
- The console owns the hetzner migrations. Do not run `prisma migrate` or `prisma db push` against hetzner, because either can try to change or drop tables the console depends on. Introspect with `prisma db pull` and map the models with `@@map` and `@map`. Add the tables to `schema.prisma` so the file matches the database.
- Rating, tasks completed and total earned are no longer stored on the Xpert. The console derives them from jobs and feedback. Stop writing them.
- `prisonFacility`, `releaseDate`, `offenseLevel`, `offenseNotes`, `idCardNumber`, `idType` and `idVerificationRef` move to `xpert_restricted`, which only `backend_user` can reach. The Ghana Card number is not stored: keep only `id_type`, `id_last4` (the last four letters and digits) and `id_hash`, an HMAC of the normalised number made with a secret held in Railway variables. Never return any of these to the browser except the masked last four.
- Skills move from a free text array to `xpert_skill`, which points at real category and task type codes in `service_category` and `task_type`. The registration screen must offer only those. The catalogue is read only: the backend cannot add, rename or remove an entry.

## 1. New registrations start switched off

The database default does this for you: a new `xpert` row is `applied` with `account_active = false`. Registration (`routes/auth.js`, `POST /worker-register`, which today sets `isActive: true`) must stop setting any status column. If it does, the database refuses the insert with error 42501.

## 2. Refuse work for Xperts who are not approved

Put one check in front of every route an Xpert uses to find or take work: job and offer lists, accepting or declining, availability, dashboard data and push subscription. It must read the live value, so approval and removal take effect with no deploy.

```js
// requireApprovedXpert.js (Express, Prisma)
module.exports = async function requireApprovedXpert(req, res, next) {
  // The auth middleware has already put the signed in Xpert's id on req.user.
  const rows = await prisma.$queryRaw`select account_active, xpert_status from xpert where id = ${req.user.id}::uuid and deleted_at is null`
  const row = rows[0]
  if (!row || row.account_active !== true) {
    return res.status(403).json({
      code: 'xpert_not_active',
      status: row ? row.xpert_status : null,
      message: 'Your application is being reviewed. We will contact you when it is approved.',
    })
  }
  next()
}
```

Use it like `router.get('/', auth, requireApprovedXpert, listTasks)`. Leave sign in, profile editing and the application screens open so an applicant can still see their status and finish their details. The Xpert app should treat `code: 'xpert_not_active'` as "show the review screen", not as an error.

## 3. Keep unapproved Xperts out of what employers can see

The list employers can see (`routes/workers.js`, `GET /`, which today filters on `isActive: true`) and any search, match, proximity or profile route an employer can reach must filter on `account_active = true and deleted_at is null`. Do the same wherever the backend picks Xperts automatically, such as notifications to nearby Xperts. Under Review keeps access by default (a pending setting). If the business decides otherwise, the console switches `account_active` off on that move and the filter hides them with no further code.

A backup Xpert must never appear in anything an employer sees. When Phase 7B adds it, the console's API for the main site will not return one, and this backend must not add one back.

## 4. Do not write to the status columns

The backend must not set `xpert_status`, `account_active`, `activated_by`, `activated_at` or `verification_source`. Only the console changes them, through one database function that records every change. Two writers would break the history. The grants and a trigger make this impossible, not just discouraged.

## 5. Check list

- Register a new test Xpert. Confirm the row has `account_active = false`.
- With that Xpert's token, call an offers route. Confirm a 403 with `code: 'xpert_not_active'`.
- Confirm the employer facing Xpert list does not show them.
- Approve them in the console. Confirm all three behaviours flip with no deploy.
- Suspend them in the console. Confirm they lose access straight away.
- Try to update `xpert_status` from the backend's own connection. Confirm the database refuses.

## 6. Existing Xperts

They are copied from the old database by `scripts/import-from-legacy.mjs`, which keeps their ids. Existing accounts that were switched off become Inactive. The status for existing active Xperts (provisionally or fully active) is chosen when the import is applied. See `docs/SETUP.md`, Part 1b.
