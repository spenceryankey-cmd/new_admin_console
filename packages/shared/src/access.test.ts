import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  PERMISSION_LABELS,
  ROLES,
  ROLE_LABELS,
  can,
  inviteStaffSchema,
  updateStaffSchema,
} from './index'

describe('access catalog', () => {
  it('has a label for every role and permission', () => {
    for (const r of ROLES) expect(ROLE_LABELS[r]).toBeTruthy()
    for (const p of PERMISSIONS) expect(PERMISSION_LABELS[p]).toBeTruthy()
  })

  it('only grants permissions that exist', () => {
    for (const r of ROLES) for (const p of DEFAULT_ROLE_PERMISSIONS[r]) expect(PERMISSIONS).toContain(p)
  })

  it('super_admin holds everything', () => {
    expect([...DEFAULT_ROLE_PERMISSIONS.super_admin].sort()).toEqual([...PERMISSIONS].sort())
  })

  it('gives quotes.compose to every role that can see the dashboard', () => {
    for (const r of ROLES) {
      if (DEFAULT_ROLE_PERMISSIONS[r].includes('dashboard.view')) expect(DEFAULT_ROLE_PERMISSIONS[r]).toContain('quotes.compose')
    }
  })

  it('keeps finance_approver to quotes and payments, with no Xpert decisions', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.finance_approver).toContain('payments.record')
    expect(DEFAULT_ROLE_PERMISSIONS.finance_approver).not.toContain('xperts.approve')
    expect(DEFAULT_ROLE_PERMISSIONS.finance_approver).not.toContain('xperts.status.decide')
  })

  it('keeps status decisions and approval with decision_maker only', () => {
    for (const r of ['ops_reviewer', 'finance_approver'] as const) {
      expect(DEFAULT_ROLE_PERMISSIONS[r]).not.toContain('xperts.approve')
      expect(DEFAULT_ROLE_PERMISSIONS[r]).not.toContain('xperts.status.decide')
    }
    expect(DEFAULT_ROLE_PERMISSIONS.decision_maker).toContain('xperts.approve')
    expect(DEFAULT_ROLE_PERMISSIONS.decision_maker).toContain('xperts.status.decide')
  })

  it('keeps staff management with super_admin only', () => {
    for (const r of ROLES.filter((x) => x !== 'super_admin')) {
      expect(DEFAULT_ROLE_PERMISSIONS[r]).not.toContain('staff.manage')
      expect(DEFAULT_ROLE_PERMISSIONS[r]).not.toContain('audit.read')
    }
  })
})

describe('can()', () => {
  it('requires every listed permission', () => {
    const s = { role: 'ops_reviewer' as const, permissions: new Set(['xperts.read'] as const) }
    expect(can(s, 'xperts.read')).toBe(true)
    expect(can(s, ['xperts.read', 'quotes.read'])).toBe(false)
    expect(can(s, 'staff.manage')).toBe(false)
  })

  it('lets super_admin through even with an empty grant set', () => {
    expect(can({ role: 'super_admin', permissions: new Set() }, 'staff.manage')).toBe(true)
  })
})

describe('migration seed', () => {
  it('matches DEFAULT_ROLE_PERMISSIONS exactly across all migrations', () => {
    const dir = resolve(__dirname, '../../../supabase/migrations')
    const pairs: string[] = []
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
      const sql = readFileSync(resolve(dir, f), 'utf8')
      for (const block of sql.split('insert into public.role_permission (role, permission) values').slice(1)) {
        const seed = block.split('on conflict')[0]!
        for (const m of seed.matchAll(/\('([a-z_]+)',\s*'([a-z_.]+)'\)/g)) pairs.push(`${m[1]}:${m[2]}`)
      }
    }
    // A later migration may revoke a permission for every role (update ... set granted = false where permission = '...').
    const revoked = new Set<string>()
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
      const sql = readFileSync(resolve(dir, f), 'utf8')
      for (const m of sql.matchAll(/update public\.role_permission\s+set granted = false[^;]*?where permission = '([a-z_.]+)'/g)) revoked.add(m[1]!)
    }
    const kept = pairs.filter((p) => !revoked.has(p.split(':')[1]!))
    const expected = ROLES.flatMap((r) => DEFAULT_ROLE_PERMISSIONS[r].map((p) => `${r}:${p}`)).sort()
    expect([...new Set(kept)].sort()).toEqual(expected)
  })
})

describe('input schemas', () => {
  it('normalises and validates invites', () => {
    const ok = inviteStaffSchema.parse({ email: '  Ops@Example.COM ', fullName: 'Win Din', role: 'ops_reviewer' })
    expect(ok.email).toBe('ops@example.com')
    expect(() => inviteStaffSchema.parse({ email: 'nope', fullName: 'A B', role: 'ops_reviewer' })).toThrow()
    expect(() => inviteStaffSchema.parse({ email: 'a@b.co', fullName: 'A B', role: 'owner' })).toThrow()
  })

  it('requires a reason and at least one change when updating staff', () => {
    expect(() => updateStaffSchema.parse({ role: 'ops_reviewer' })).toThrow()
    expect(() => updateStaffSchema.parse({ reason: 'because' })).toThrow()
    expect(updateStaffSchema.parse({ role: 'ops_reviewer', reason: 'moved teams' }).role).toBe('ops_reviewer')
  })
})
