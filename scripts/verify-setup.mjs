#!/usr/bin/env node
// Checks that the admin side is set up. Reads the same variables as the API.
//   node --env-file=.env scripts/verify-setup.mjs
// Add API_URL=https://your-api.up.railway.app to also check the deployed API answers.
// It only reads. It never writes, and it never prints a key.
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'

const env = process.env
const results = []
const ok = (name, detail = '') => results.push({ pass: true, name, detail })
const bad = (name, fix) => results.push({ pass: false, name, fix })
const postgresUrl = /^postgres(ql)?:\/\//

// 1. Variables ---------------------------------------------------------------
const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'WEB_APP_URL', 'HETZNER_DATABASE_URL', 'HETZNER_WRITE_DATABASE_URL']
const missing = required.filter((k) => !env[k])
if (missing.length) bad('Variables are set', `Missing: ${missing.join(', ')}. See .env.example.`)
else ok('Variables are set')
for (const k of ['HETZNER_DATABASE_URL', 'HETZNER_WRITE_DATABASE_URL']) if (env[k] && !postgresUrl.test(env[k])) bad(`${k} is a postgres connection string`, 'It should start with postgres:// or postgresql://')
if (env.HETZNER_DATABASE_URL && env.HETZNER_DATABASE_URL === env.HETZNER_WRITE_DATABASE_URL) bad('The reader and the writer are different database users', 'Create two users (console_read and console_write roles) and give each its own connection string.')
if (env.CORS_ORIGINS && env.WEB_APP_URL && !env.CORS_ORIGINS.split(',').map((s) => s.trim().replace(/\/$/, '')).includes(env.WEB_APP_URL.replace(/\/$/, ''))) {
  bad('CORS_ORIGINS includes the console address', 'Add the value of WEB_APP_URL to CORS_ORIGINS, or the browser will block every request.')
}

if (missing.length) finish()

const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

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
  ['0009', ['service_category', 'task_type']],
]) {
  for (const t of tables) {
    const err = await exists(t)
    err ? bad(`Table ${t} exists`, `Run migration ${file} (supabase/migrations).`) : ok(`Table ${t} exists`)
  }
}

// The console's copy of the catalogue, and any older rows that do not match it.
{
  const [c, t, m] = await Promise.all([
    db.from('service_category').select('code', { head: true, count: 'exact' }),
    db.from('task_type').select('code', { head: true, count: 'exact' }),
    db.from('catalogue_mismatches').select('table_name,row_id,category').limit(5),
  ])
  c.count === 10 && t.count === 40 ? ok('The console catalogue is seeded (10 categories, 40 task types)') : bad('The console catalogue is seeded (10 categories, 40 task types)', `Found ${c.count ?? 0} categories and ${t.count ?? 0} task types. Run supabase/migrations/0009_catalogue.sql.`)
  if (m.error) bad('Category links are in place', 'Run supabase/migrations/0010_catalogue_links_feedback.sql.')
  else if (m.data?.length) bad('Every saved category is on the list', `${m.data.length}+ older rows use a category that is not one of the ten (first: ${m.data[0].table_name} ${m.data[0].row_id}, "${m.data[0].category}"). Review them, then validate the constraints (see 0010).`)
  else ok('Every saved category is on the list')
}

// 3. The hetzner database (Xpert records) ------------------------------------------------------
const sslMode = env.HETZNER_SSL ?? 'require'
const ssl = sslMode === 'disable' ? false : sslMode === 'no-verify' ? { rejectUnauthorized: false } : { rejectUnauthorized: true, ...(env.HETZNER_CA_CERT ? { ca: env.HETZNER_CA_CERT.replace(/\\n/g, '\n') } : {}) }
if (sslMode === 'no-verify') bad('The database certificate is checked', 'HETZNER_SSL=no-verify skips checking the server certificate. Use require (and HETZNER_CA_CERT if needed), or disable only on a private network.')
async function asUser(url, fn) {
  const c = new pg.Client({ connectionString: url, ssl, connectionTimeoutMillis: 8000 })
  try { await c.connect() } catch (e) { return { connectError: e.message } }
  try { return { value: await fn(c) } } finally { await c.end() }
}
const denied = async (c, sql) => { try { await c.query(sql); return false } catch (e) { return e.code === '42501' } }

const reader = await asUser(env.HETZNER_DATABASE_URL, async (c) => ({
  tables: (await c.query("select table_name from information_schema.tables where table_schema = 'public'")).rows.map((r) => r.table_name),
  categories: (await c.query('select count(*)::int n from service_category')).rows[0].n,
  taskTypes: (await c.query('select count(*)::int n from task_type')).rows[0].n,
  noSecrets: await denied(c, 'select pin_hash from xpert'),
  noRestricted: await denied(c, 'select * from xpert_restricted'),
  noWrites: await denied(c, "update xpert set full_name = full_name where false"),
}))
if (reader.connectError) bad('The reader connects to the hetzner database', `${reader.connectError}. Check HETZNER_DATABASE_URL, HETZNER_SSL and the network (private address inside one Railway project, otherwise the TCP proxy with SSL).`)
else {
  ok('The reader connects to the hetzner database')
  const r = reader.value
  for (const t of ['service_category', 'task_type', 'xpert', 'xpert_skill', 'xpert_status_history', 'employer', 'audit_log']) {
    r.tables.includes(t) ? ok(`Table ${t} exists in hetzner`) : bad(`Table ${t} exists in hetzner`, 'Run the hetzner migrations in order (hetzner/migrations).')
  }
  r.categories === 10 && r.taskTypes === 40 ? ok('Catalogue is seeded (10 categories, 40 task types)') : bad('Catalogue is seeded (10 categories, 40 task types)', `Found ${r.categories} categories and ${r.taskTypes} task types. Run hetzner/migrations/0002_seed_catalog.sql.`)
  r.noSecrets ? ok('The reader cannot read PIN hashes') : bad('The reader cannot read PIN hashes', 'The reader user has more access than it should. Use a login created in role console_read and nothing else.')
  r.noRestricted ? ok('The reader cannot read the restricted table') : bad('The reader cannot read the restricted table', 'Revoke access to xpert_restricted from the reader.')
  r.noWrites ? ok('The reader cannot change data') : bad('The reader cannot change data', 'The reader user can write. Use a login created in role console_read and nothing else.')
}
const writer = await asUser(env.HETZNER_WRITE_DATABASE_URL, async (c) => ({
  canRun: (await c.query("select has_function_privilege(current_user, 'xpert_apply_transition(uuid,text,text,text,text,text,boolean,boolean,text)', 'execute') as ok")).rows[0].ok,
  noRead: await denied(c, 'select id from xpert'),
}))
if (writer.connectError) bad('The writer connects to the hetzner database', `${writer.connectError}. Check HETZNER_WRITE_DATABASE_URL.`)
else {
  ok('The writer connects to the hetzner database')
  writer.value.canRun ? ok('The writer can run the status transition function') : bad('The writer can run the status transition function', 'Run hetzner/migrations/0003_xpert_status.sql and create the login in role console_write.')
  writer.value.noRead ? ok('The writer can do nothing else') : bad('The writer can do nothing else', 'The writer user can read tables directly. Use a login created in role console_write and nothing else.')
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

// 5b. Token checking and the second factor ---------------------------------------------------
// The API checks tokens itself against the project's public signing keys, so those keys must exist.
try {
  const res = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`)
  const keys = res.ok ? ((await res.json()).keys ?? []) : []
  keys.some((k) => ['ES256', 'RS256', 'EdDSA'].includes(k.alg) || k.kty === 'EC' || k.kty === 'RSA' || k.kty === 'OKP')
    ? ok('Supabase publishes public signing keys (the API can check tokens itself)')
    : bad('Supabase publishes public signing keys', 'Turn on JWT signing keys (asymmetric) for the project in Supabase, under Settings, JWT Keys. The API refuses every token until the keys exist.')
} catch {
  bad('Supabase publishes public signing keys', 'Could not reach the key address. Check SUPABASE_URL.')
}
{
  const col = await db.from('staff_profile').select('mfa_enrolled_at').limit(1)
  col.error ? bad('Second factor column exists', 'Run supabase/migrations/0011_mfa.sql.') : ok('Second factor column exists')
  const missing = await db.from('staff_profile').select('email,role').in('role', ['super_admin', 'decision_maker']).eq('is_active', true).is('mfa_enrolled_at', null)
  if (!col.error) {
    missing.data?.length
      ? ok('Super admins and decision makers who have not set up an authenticator app yet', `${missing.data.length}; they will be asked at their next sign in`)
      : ok('Every active super admin and decision maker has signed in with an authenticator code')
  }
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
