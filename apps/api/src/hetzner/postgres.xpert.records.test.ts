import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { PostgresXpertRecords, isUuid } from './postgres.xpert.records'
import { HetznerService, sslFor } from './hetzner.service'
import { StoreError } from '../xperts/xpert.store'

// The database tests need a real Postgres with the hetzner migrations applied and the three
// users created. scripts/db/test-hetzner-store.sh sets that up. Without it these tests are skipped.
const ADMIN = process.env.HETZNER_TEST_ADMIN_URL
const READ = process.env.HETZNER_TEST_READ_URL
const WRITE = process.env.HETZNER_TEST_WRITE_URL
const run = ADMIN && READ && WRITE ? describe : describe.skip

describe('connection settings', () => {
  it('verifies the server certificate by default', () => {
    expect(sslFor('require')).toEqual({ rejectUnauthorized: true })
  })
  it('can switch TLS off for a private network, or skip verification only on request', () => {
    expect(sslFor('disable')).toBe(false)
    expect(sslFor('no-verify')).toEqual({ rejectUnauthorized: false })
  })
  it('accepts a certificate authority with escaped newlines', () => {
    expect(sslFor('require', 'a\\nb')).toEqual({ rejectUnauthorized: true, ca: 'a\nb' })
  })
  it('recognises real ids and refuses malformed ones', () => {
    expect(isUuid('3f2b8c1e-5a77-4c0e-9a41-0d3b6f1e2a10')).toBe(true)
    expect(isUuid('x1')).toBe(false)
    expect(isUuid("1'; drop table xpert; --")).toBe(false)
  })
})

run('PostgresXpertRecords against a real database', () => {
  let admin: Pool
  let records: PostgresXpertRecords
  let hz: HetznerService
  const ids: Record<string, string> = {}
  const I = (k: string) => ids[k]!

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN })
    hz = new HetznerService({ HETZNER_DATABASE_URL: READ, HETZNER_WRITE_DATABASE_URL: WRITE, HETZNER_SSL: 'disable' } as never)
    records = new PostgresXpertRecords(hz)
    const mk = async (code: string, name: string, phone: string) => {
      const r = await admin.query("insert into xpert (xpert_code, full_name, phone, pin_hash, home_area, guarantor_name, guarantor_phone, guarantor_relationship) values ($1,$2,$3,'secret-hash','Madina','Esi','0200','aunt') returning id", [code, name, phone])
      ids[code] = r.rows[0].id as string
    }
    await mk('T-1', 'Ama Plumber', '0501'); await mk('T-2', 'Kofi 100% Sure', '0502'); await mk('T-3', 'Yaw Tiler', '0503')
    await admin.query("insert into xpert_skill (xpert_id, category_code, task_type_code) values ($1,'skilled_trades','skilled_trades.plumbing_installation_repair'), ($1,'painting_finishing',null)", [I('T-1')])
  })
  afterAll(async () => { await hz.onModuleDestroy(); await admin.end() })

  it('lists Xperts newest first with category and task labels as skills, and never exposes secrets', async () => {
    const { rows, total } = await records.list({ limit: 10, offset: 0 })
    expect(total).toBe(3)
    const ama = rows.find((x) => x.id === I('T-1'))!
    expect(ama.skills).toEqual(['Painting & Finishing', 'Plumbing installation & repair', 'Skilled Trades'])
    expect(ama.status).toBe('applied')
    expect(ama.accountActive).toBe(false)
    expect(JSON.stringify(rows)).not.toMatch(/secret-hash|pin_hash/)
  })

  it('searches by name or phone and treats percent signs as plain text', async () => {
    expect((await records.list({ q: 'tiler', limit: 10, offset: 0 })).total).toBe(1)
    expect((await records.list({ q: '0502', limit: 10, offset: 0 })).total).toBe(1)
    expect((await records.list({ q: '%', limit: 10, offset: 0 })).total).toBe(1) // only "100%" matches, not everything
    expect((await records.list({ q: "x'; drop table xpert; --", limit: 10, offset: 0 })).total).toBe(0)
  })

  it('treats a malformed id as not found instead of failing', async () => {
    expect(await records.get('x1')).toBeNull()
    expect((await records.byIds(['x1', I('T-1')])).size).toBe(1)
    expect(await records.legacyGuarantor('x1')).toBeNull()
    await expect(records.applyTransition({ xpertId: 'x1', expectedFrom: 'applied', to: 'guarantor_pending', trigger: null, reason: null, actorId: null, automatic: true, setActive: null })).rejects.toMatchObject({ kind: 'not_found' })
  })

  it('reads the guarantor details from the application', async () => {
    expect(await records.legacyGuarantor(I('T-1'))).toMatchObject({ name: 'Esi', contact: '0200', relationship: 'aunt' })
  })

  it('moves status with history, refuses a stale move, and switches the account on at approval', async () => {
    const id = I('T-1')
    const hid = await records.applyTransition({ xpertId: id, expectedFrom: 'applied', to: 'guarantor_pending', trigger: 'guarantor_named', reason: 'Guarantor named', actorId: null, automatic: true, setActive: null })
    expect(hid).toBeGreaterThan(0)
    await expect(records.applyTransition({ xpertId: id, expectedFrom: 'applied', to: 'guarantor_pending', trigger: null, reason: null, actorId: null, automatic: true, setActive: null })).rejects.toBeInstanceOf(StoreError)
    await expect(records.applyTransition({ xpertId: id, expectedFrom: 'applied', to: 'guarantor_pending', trigger: null, reason: null, actorId: null, automatic: true, setActive: null })).rejects.toMatchObject({ kind: 'conflict' })
    await records.applyTransition({ xpertId: id, expectedFrom: 'guarantor_pending', to: 'provisional_active', trigger: 'admin_approved', reason: 'Approved', actorId: '8d1c7b3a-0000-4000-8000-000000000001', automatic: false, setActive: true, verificationSource: 'direct_beyondx' })
    const x = (await records.get(id))!
    expect(x).toMatchObject({ status: 'provisional_active', accountActive: true, verificationSource: 'direct_beyondx' })
    expect(x.activatedAt).not.toBeNull()
    const h = await records.history(id)
    expect(h.map((r) => r.newStatus)).toEqual(['provisional_active', 'guarantor_pending'])
    expect(h[0]!).toMatchObject({ changedBy: '8d1c7b3a-0000-4000-8000-000000000001', automatic: false, trigger: 'admin_approved' })
    expect((await records.lastEntered([id, I('T-2')], 'provisional_active')).has(id)).toBe(true)
    expect(await records.countByStatus('provisional_active')).toBe(1)
    expect((await records.byStatus('applied', 10)).length).toBe(2)
  })

  it('exposes the audit rows so the console can copy any it missed', async () => {
    const rows = await records.recentStatusAudit(new Date(Date.now() - 3_600_000))
    expect(rows.length).toBeGreaterThanOrEqual(2)
    expect(rows[0]!.externalRef).toMatch(/^xpert_status:\d+$/)
    expect(rows.every((r) => r.xpertId === I('T-1'))).toBe(true)
  })

  it('reports which ids exist, ignoring malformed ones', async () => {
    const found = await records.existingIds([I('T-1'), '3f2b8c1e-5a77-4c0e-9a41-0d3b6f1e2a10', 'nope'])
    expect([...found]).toEqual([I('T-1')])
  })

  it('cannot be used to read secrets or change data directly', async () => {
    await expect(hz.read.query('select pin_hash from xpert')).rejects.toMatchObject({ code: '42501' })
    await expect(hz.read.query("update xpert set full_name = 'x'")).rejects.toMatchObject({ code: '42501' })
    await expect(hz.write.query('select id from xpert')).rejects.toMatchObject({ code: '42501' })
  })
})
