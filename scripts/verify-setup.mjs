#!/usr/bin/env node
// Checks that the admin side is set up. Reads the same variables as the API.
//   node --env-file=.env scripts/verify-setup.mjs
// Add API_URL=https://your-api.up.railway.app to also check the deployed API answers.
// It only reads. It never writes, and it never prints a key.
import { createClient } from '@supabase/supabase-js'

const env = process.env
const results = []
const ok = (name, detail = '') => results.push({ pass: true, name, detail })
const bad = (name, fix) => results.push({ pass: false, name, fix })
const ident = /^[a-z_][a-z0-9_]*$/

// 1. Variables ---------------------------------------------------------------
const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'WEB_APP_URL', 'XPERT_TABLE']
const missing = required.filter((k) => !env[k])
if (missing.length) bad('Variables are set', `Missing: ${missing.join(', ')}. See .env.example.`)
else ok('Variables are set')
if (env.XPERT_TABLE && !ident.test(env.XPERT_TABLE)) bad('XPERT_TABLE is a plain name', 'Use lowercase letters, digits and underscores only.')
if (env.CORS_ORIGINS && env.WEB_APP_URL && !env.CORS_ORIGINS.split(',').map((s) => s.trim().replace(/\/$/, '')).includes(env.WEB_APP_URL.replace(/\/$/, ''))) {
  bad('CORS_ORIGINS includes the console address', 'Add the value of WEB_APP_URL to CORS_ORIGINS, or the browser will block every request.')
}

if (missing.length) finish()

const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const xpertTable = env.XPERT_TABLE
const col = (name) => env[name] || null

async function exists(table, select = '*') {
  const { error } = await db.from(table).select(select, { head: true, count: 'exact' }).limit(1)
  return error
}

// 2. Connection and tables ------------------------------------------------------
const e0 = await exists('staff_profile')
if (e0 && /Invalid API key|JWT|apikey/i.test(e0.message)) {
  bad('Supabase accepts the service role key', 'Copy the service_role key (not the anon key) from Project Settings, API.')
  finish()
} else if (e0 && /fetch failed|ENOTFOUND|network/i.test(e0.message)) {
  bad('Supabase address is reachable', 'Check SUPABASE_URL. It looks like https://YOUR-PROJECT.supabase.co')
  finish()
}
ok('Supabase accepts the service role key')

for (const [file, tables] of [
  ['0001', ['staff_profile', 'role_permission', 'audit_log']],
  ['0002a', ['status_history', 'guarantor', 'skill_evidence', 'reference_check', 'console_config']],
  ['0003', ['benchmark_rate', 'price_band', 'job_request', 'quote', 'payment']],
  ['0004', ['job', 'assignment', 'change_order', 'recurring_service']],
  ['0005', ['coordinator', 'coordinator_xpert', 'flag', 'feedback']],
]) {
  for (const t of tables) {
    const err = await exists(t)
    err ? bad(`Table ${t} exists`, `Run migration ${file} (supabase/migrations).`) : ok(`Table ${t} exists`)
  }
}

// 3. The Xpert table and the columns migration 0002b adds ---------------------------
const xErr = await exists(xpertTable)
if (xErr) bad(`Xpert table "${xpertTable}" exists`, 'XPERT_TABLE does not match a table. Check the schema export and fix the variable.')
else {
  ok(`Xpert table "${xpertTable}" exists`)
  const statusErr = await exists(xpertTable, 'xpert_status,account_active,activated_by,activated_at,verification_source')
  statusErr ? bad('Xpert status columns exist', 'Generate and run 0002b (node scripts/generate-0002b.mjs scripts/xpert-schema.json).') : ok('Xpert status columns exist')
  const mapped = [
    col('XPERT_ID_COLUMN') ?? 'id',
    ...(col('XPERT_NAME_COLUMNS') ?? 'full_name').split(','),
    col('XPERT_PHONE_COLUMN') ?? 'phone',
    col('XPERT_CREATED_COLUMN') ?? 'created_at',
    ...['XPERT_AREA_COLUMN', 'XPERT_SKILLS_COLUMN', 'XPERT_GUARANTOR_NAME_COLUMN', 'XPERT_GUARANTOR_CONTACT_COLUMN', 'XPERT_GUARANTOR_RELATIONSHIP_COLUMN'].map(col).filter(Boolean),
  ]
  const colErr = await exists(xpertTable, mapped.join(','))
  colErr ? bad('Xpert column names match', `A mapped column does not exist (${colErr.message}). Fix the XPERT_* variables.`) : ok('Xpert column names match')
}

// 4. Staff, grants and storage ----------------------------------------------------------
const { data: admins, error: aErr } = await db.from('staff_profile').select('user_id').eq('role', 'super_admin').eq('is_active', true)
if (aErr) bad('A super admin exists', aErr.message)
else if (!admins?.length) bad('A super admin exists', 'Run supabase/seed/bootstrap_super_admin.sql after editing the name and email.')
else ok('A super admin exists', `${admins.length} active`)

const { data: grant } = await db.from('role_permission').select('role').eq('permission', 'xperts.status.voluntary').eq('granted', true)
grant?.length ? ok('Role grants for the new permission are seeded') : bad('Role grants for the new permission are seeded', 'Migration 0002a was not run in full.')

const { data: buckets, error: bErr } = await db.storage.listBuckets()
const bucket = buckets?.find((b) => b.id === 'xpert-evidence')
if (bErr) bad('Evidence bucket exists', bErr.message)
else if (!bucket) bad('Evidence bucket exists', 'Create a private bucket named xpert-evidence (migration 0002a does this).')
else bucket.public ? bad('Evidence bucket is private', 'Make the xpert-evidence bucket private in Storage settings.') : ok('Evidence bucket exists and is private')

// 5. Auth: staff and employers share one pool, so sign ups must stay on --------------------
try {
  const res = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/settings`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY } })
  if (res.ok) {
    const s = await res.json()
    s.disable_signup ? bad('Email sign ups are still on', 'Turn sign ups back on. The main site uses them for employers. The console is protected by staff_profile instead.') : ok('Email sign ups are still on (the main site needs them)')
    s.mailer_autoconfirm === true ? bad('Email confirmation is required', 'Keep email confirmation on for employers.') : ok('Email confirmation is required')
  }
} catch {
  /* Not fatal: the settings endpoint is a convenience check. */
}

// 6. Deployed API ----------------------------------------------------------------------------
if (env.API_URL) {
  try {
    const res = await fetch(`${env.API_URL.replace(/\/$/, '')}/health`)
    res.ok ? ok('Deployed API answers /health') : bad('Deployed API answers /health', `Got status ${res.status}. Check the Railway deploy logs.`)
    const unauth = await fetch(`${env.API_URL.replace(/\/$/, '')}/staff`)
    unauth.status === 401 ? ok('Deployed API refuses requests with no sign in') : bad('Deployed API refuses requests with no sign in', `Expected 401, got ${unauth.status}.`)
  } catch {
    bad('Deployed API answers /health', 'The address did not answer. Check API_URL and the Railway domain.')
  }
}

finish()

function finish() {
  let failed = 0
  for (const r of results) {
    if (r.pass) console.log(`PASS  ${r.name}${r.detail ? ` (${r.detail})` : ''}`)
    else {
      failed++
      console.log(`FAIL  ${r.name}\n      ${r.fix}`)
    }
  }
  console.log(failed ? `\n${failed} check${failed === 1 ? '' : 's'} failed.` : '\nEverything checked is in place.')
  process.exit(failed ? 1 : 0)
}
