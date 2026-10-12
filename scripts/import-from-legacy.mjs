#!/usr/bin/env node
// One off import of the existing Xperts and employers from the main site's current database
// (Express and Prisma, tables "Worker" and "Employer") into the hetzner database.
//
//   Dry run (default, writes nothing):
//     LEGACY_DATABASE_URL=... HETZNER_ADMIN_DATABASE_URL=... node scripts/import-from-legacy.mjs
//   Apply:
//     ... node scripts/import-from-legacy.mjs --apply --existing-active-status=provisional_active
//
// Credentials come from environment variables only. Never paste them into chat, GitHub or email.
// LEGACY_DATABASE_URL should be a read only user. HETZNER_ADMIN_DATABASE_URL is the database owner,
// used only for this import (the console and the backend use their own limited users afterwards).
//
// Rules it keeps:
//  - Nothing is guessed. A skill that does not match a catalogue label exactly is listed, not mapped.
//  - The Ghana Card number is never copied. Only its type, its last four characters and a keyed hash
//    (ID_HASH_SECRET) are stored.
//  - Safe to repeat: rows already imported are skipped by id.
//  - Each imported Xpert gets a history row saying where they came from.
//  - The status of existing Xperts is a business decision, so --apply refuses to run without
//    --existing-active-status. Legacy accounts that were switched off become Inactive.
import { createHmac } from 'node:crypto'
import pg from 'pg'

const args = process.argv.slice(2)
const flag = (name) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
const value = (name) => (flag(name)?.includes('=') ? flag(name).split('=').slice(1).join('=') : null)
const apply = !!flag('apply')
const skipRestricted = !!flag('skip-restricted')
const activeStatus = value('existing-active-status')

const LEGACY = process.env.LEGACY_DATABASE_URL
const TARGET = process.env.HETZNER_ADMIN_DATABASE_URL
const SECRET = process.env.ID_HASH_SECRET
const ssl = process.env.IMPORT_SSL === 'disable' ? false : process.env.IMPORT_SSL === 'no-verify' ? { rejectUnauthorized: false } : { rejectUnauthorized: true }
if (!LEGACY || !TARGET) {
  console.error('Set LEGACY_DATABASE_URL and HETZNER_ADMIN_DATABASE_URL (environment variables only).')
  process.exit(1)
}
if (apply && !['provisional_active', 'full_active'].includes(activeStatus ?? '')) {
  console.error('Refusing to apply: choose the status for existing active Xperts with --existing-active-status=provisional_active or full_active. This is a business decision, so there is no default.')
  process.exit(1)
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/&/g, ' ').replace(/\s+/g, ' ').trim()

const legacy = new pg.Client({ connectionString: LEGACY, ssl })
const target = new pg.Client({ connectionString: TARGET, ssl })
await legacy.connect()
await target.connect()

// The live legacy database can differ from the Prisma file (older columns were pushed by hand), so read
// only the columns that really exist and treat the rest as empty.
async function rows(table, wanted) {
  const have = new Set((await legacy.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = $1", [table])).rows.map((r) => r.column_name))
  if (have.size === 0) throw new Error(`The legacy table "${table}" was not found.`)
  const cols = wanted.filter((c) => have.has(c))
  const missing = wanted.filter((c) => !have.has(c))
  const r = await legacy.query(`select ${cols.map((c) => `"${c}"`).join(', ')} from "${table}"`)
  return { rows: r.rows, missing }
}

const report = { xperts: { read: 0, coordinatorsSkipped: 0, inserted: 0, alreadyThere: 0, inactive: 0, active: 0 }, employers: { read: 0, inserted: 0, alreadyThere: 0 }, skills: { linked: 0, unmatched: new Map() }, restricted: 0, missingColumns: [], noPhone: 0, duplicatePhones: [] }

try {
  // Catalogue to match skills against, exactly.
  const cats = (await target.query('select code, label from service_category')).rows
  const tasks = (await target.query('select code, category_code, label from task_type')).rows
  const catByLabel = new Map(cats.map((c) => [norm(c.label), c]))
  const taskByLabel = new Map(tasks.map((t) => [norm(t.label), t]))

  const W = await rows('Worker', ['id', 'workerId', 'fullName', 'pinHash', 'phone', 'prisonFacility', 'releaseDate', 'offenseLevel', 'offenseNotes', 'skills', 'bio', 'hasTools', 'dailyCharge', 'gpsVerified', 'idVerified', 'idVerificationRef', 'idType', 'idCardNumber', 'guarantorName', 'guarantorPhone', 'guarantorRelationship', 'lastActiveAt', 'photoUrl', 'homeArea', 'homeLat', 'homeLng', 'isActive', 'role', 'createdAt'])
  const E = await rows('Employer', ['id', 'email', 'passwordHash', 'orgName', 'contactPerson', 'phone', 'address', 'region', 'isVerified', 'logoUrl', 'acknowledgedAt', 'createdAt'])
  report.missingColumns = [...W.missing.map((c) => `Worker.${c}`), ...E.missing.map((c) => `Employer.${c}`)]
  report.xperts.read = W.rows.length
  report.employers.read = E.rows.length

  if (apply && W.rows.some((w) => w.idCardNumber) && !SECRET) throw new Error('Set ID_HASH_SECRET (a long random value kept in Railway variables). It makes the Ghana Card hash. Without it the numbers cannot be checked for duplicates.')

  const phones = new Map()
  for (const w of W.rows) if (w.phone) phones.set(w.phone, (phones.get(w.phone) ?? 0) + 1)
  report.duplicatePhones = [...phones].filter(([, n]) => n > 1).map(([p]) => p)

  if (apply) await target.query('begin')
  await target.query("select set_config('bx.status_write', 'on', true)")

  for (const w of W.rows) {
    if (w.role && w.role !== 'worker') { report.xperts.coordinatorsSkipped++; continue }
    if (!w.phone) report.noPhone++
    const isActive = w.isActive !== false
    const status = isActive ? activeStatus ?? '(chosen at apply)' : 'inactive'
    isActive ? report.xperts.active++ : report.xperts.inactive++

    const dup = report.duplicatePhones.includes(w.phone)
    const exists = (await target.query('select 1 from xpert where id = $1', [w.id])).rowCount > 0
    if (exists) { report.xperts.alreadyThere++; continue }

    // Skills: exact label matches only.
    const links = []
    for (const s of w.skills ?? []) {
      const key = norm(s)
      const c = catByLabel.get(key)
      const t = taskByLabel.get(key)
      if (c) links.push([c.code, null])
      else if (t) links.push([t.category_code, t.code])
      else report.skills.unmatched.set(s, (report.skills.unmatched.get(s) ?? 0) + 1)
    }
    report.skills.linked += links.length

    const card = w.idCardNumber ? String(w.idCardNumber).replace(/[^A-Za-z0-9]/g, '') : null
    const last4 = card && card.length >= 4 ? card.slice(-4) : null
    const idHash = card && SECRET ? createHmac('sha256', SECRET).update(card.toUpperCase()).digest('hex') : null
    const hasRestricted = !skipRestricted && (w.prisonFacility || w.releaseDate || (w.offenseLevel && w.offenseLevel !== 'none') || w.offenseNotes)
    if (hasRestricted || w.idType || last4 || w.idVerificationRef) report.restricted++

    if (!apply) { report.xperts.inserted++; continue }

    await target.query(
      `insert into xpert (id, xpert_code, full_name, phone, pin_hash, bio, photo_url, home_area, home_lat, home_lng, daily_charge, has_tools,
                          gps_verified, id_verified, last_active_at, guarantor_name, guarantor_phone, guarantor_relationship,
                          xpert_status, account_active, activated_at, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,coalesce($11,80),coalesce($12,false),coalesce($13,false),coalesce($14,false),$15,$16,$17,$18,
               $19,$20,case when $20 then now() end,coalesce($21, now()))`,
      [w.id, w.workerId, w.fullName, dup ? null : w.phone, w.pinHash, w.bio, w.photoUrl, w.homeArea, w.homeLat, w.homeLng, w.dailyCharge, w.hasTools,
       w.gpsVerified, w.idVerified, w.lastActiveAt, w.guarantorName, w.guarantorPhone, w.guarantorRelationship,
       status, isActive, w.createdAt],
    )
    await target.query(
      `insert into xpert_status_history (xpert_id, old_status, new_status, automatic, reason)
       values ($1, null, $2, true, 'Imported from the previous backend')`,
      [w.id, status],
    )
    for (const [cat, task] of links) {
      await target.query('insert into xpert_skill (xpert_id, category_code, task_type_code) values ($1,$2,$3) on conflict do nothing', [w.id, cat, task])
    }
    if (hasRestricted || w.idType || last4 || w.idVerificationRef) {
      await target.query(
        `insert into xpert_restricted (xpert_id, id_type, id_last4, id_hash, id_verification_ref, prison_facility, release_date, offense_level, offense_notes)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [w.id, w.idType, last4, idHash, w.idVerificationRef, skipRestricted ? null : w.prisonFacility, skipRestricted ? null : w.releaseDate, skipRestricted || w.offenseLevel === 'none' ? null : w.offenseLevel, skipRestricted ? null : w.offenseNotes],
      )
    }
    report.xperts.inserted++
  }

  for (const e of E.rows) {
    const exists = (await target.query('select 1 from employer where id = $1', [e.id])).rowCount > 0
    if (exists) { report.employers.alreadyThere++; continue }
    if (apply) {
      await target.query(
        `insert into employer (id, email, password_hash, org_name, contact_person, phone, address, region, is_verified, logo_url, acknowledged_at, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,coalesce($9,false),$10,$11,coalesce($12, now()))`,
        [e.id, e.email, e.passwordHash, e.orgName, e.contactPerson, e.phone, e.address, e.region, e.isVerified, e.logoUrl, e.acknowledgedAt, e.createdAt],
      )
    }
    report.employers.inserted++
  }

  if (apply) await target.query('commit')
} catch (e) {
  if (apply) await target.query('rollback').catch(() => {})
  console.error(`Import failed${apply ? ' and was rolled back' : ''}: ${e.message}`)
  process.exitCode = 1
} finally {
  await legacy.end()
  await target.end()
}

if (process.exitCode !== 1) {
  const unmatched = [...report.skills.unmatched].sort((a, b) => b[1] - a[1])
  console.log(apply ? 'IMPORT APPLIED' : 'DRY RUN (nothing was written)')
  console.log(`Xperts read ${report.xperts.read}; ${apply ? 'inserted' : 'would insert'} ${report.xperts.inserted}; already there ${report.xperts.alreadyThere}; coordinators skipped ${report.xperts.coordinatorsSkipped}`)
  console.log(`  active ${report.xperts.active} (status ${activeStatus ?? 'not chosen yet'}), switched off ${report.xperts.inactive} (Inactive)`)
  console.log(`Employers read ${report.employers.read}; ${apply ? 'inserted' : 'would insert'} ${report.employers.inserted}; already there ${report.employers.alreadyThere}`)
  console.log(`Skills linked ${report.skills.linked}; skill values that match no category or task type: ${unmatched.length}`)
  for (const [s, n] of unmatched.slice(0, 50)) console.log(`  unmatched skill: "${s}" (${n})`)
  if (report.duplicatePhones.length) console.log(`Phone numbers used by more than one Xpert (imported without the phone, fix by hand): ${report.duplicatePhones.length}`)
  if (report.noPhone) console.log(`Xperts with no phone: ${report.noPhone}`)
  console.log(`Sensitive rows ${skipRestricted ? 'skipped by request' : 'copied to the restricted table'}: ${report.restricted}`)
  if (report.missingColumns.length) console.log(`Columns not present in the legacy database (treated as empty): ${report.missingColumns.join(', ')}`)
  if (!apply) console.log('Run again with --apply and --existing-active-status=provisional_active or full_active to write.')
}
