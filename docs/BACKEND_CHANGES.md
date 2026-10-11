# Changes the main backend needs

The console owns Xpert approval. The Railway backend must respect it. These changes are small, and they are the only part of the closed loop model the console cannot do itself. The backend code was not available when this was written, so the snippets below are patterns to adapt, not paste ready code. Names marked ASSUMED need checking against the real backend.

The five new columns on the Xpert table (added by migration 0002b) are `xpert_status`, `account_active`, `activated_by`, `activated_at` and `verification_source`. The backend only ever needs to read `account_active`.

## 1. New registrations start switched off

Migration 0002b gives the columns defaults, so a new Xpert row is created with `xpert_status = 'applied'` and `account_active = false` without any code change. Check the registration code does not set these columns itself. If it inserts every column explicitly, leave the new ones out so the defaults apply.

## 2. Refuse work for Xperts who are not approved

Add one middleware and put it in front of every route an Xpert uses to find or take work: job and offer lists, accepting or declining, availability, dashboard data, and push subscription. (Express style, ASSUMED.)

```js
// requireApprovedXpert.js
module.exports = async function requireApprovedXpert(req, res, next) {
  // ASSUMED: the auth middleware has already loaded the Xpert onto req.worker or req.user.
  const xpert = req.worker || req.user
  if (!xpert) return res.status(401).json({ message: 'Sign in to continue' })

  // Read the live value, not a copy held in the token, so approval and removal take effect at once.
  const row = await Xpert.findById(xpert.id).select('account_active xpert_status')
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

Use it like `router.get('/offers', auth, requireApprovedXpert, listOffers)`. Leave sign in, profile editing and the application screens open so an applicant can still see their status and finish their details.

Return the 403 body above so the Xpert app can show a holding page. The app should treat `code: 'xpert_not_active'` as "show the review screen", not as an error.

## 3. Keep unapproved Xperts out of what employers can see

`GET /api/workers` (the list employers can see, ASSUMED name) and any search, match or profile route an employer can reach must filter on `account_active = true`:

```js
Xpert.find({ account_active: true /* plus the existing filters */ })
```

Do the same wherever the backend picks Xperts automatically, such as dispatch or notifications to nearby Xperts. Under Review keeps access by default (a pending setting). If the business decides it should not, the console sets `account_active` to false on that move, and this filter then hides them without further code.

## 4. Do not write to the new columns

The backend must not set `xpert_status`, `account_active`, `activated_by`, `activated_at` or `verification_source`. Only the console changes them, through one database function that records every change. Two writers would break the history.

## 5. Check list

- Register a new test Xpert. Confirm the row has `account_active = false`.
- With that Xpert's token, call an offers route. Confirm a 403 with `code: 'xpert_not_active'`.
- Confirm `GET /api/workers` does not list them.
- Approve them in the console. Confirm all three behaviours flip with no deploy.
- Suspend them in the console. Confirm they lose access straight away.

## 6. Where the existing Xperts stand

Migration 0002b leaves every existing Xpert with `account_active = true`, so nobody loses access when it runs. Migration 0002c, run after review, sets each one to Fully Active or Provisionally Active from their completed work. See `docs/SETUP.md`.
