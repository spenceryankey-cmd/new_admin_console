import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MFA_REQUIRED_ROLES, ROLES, isAssuranceLevel, mfaSatisfied, roleRequiresMfa } from './index'

describe('second factor rules', () => {
  it('asks super admins and decision makers, and nobody else yet', () => {
    expect([...MFA_REQUIRED_ROLES].sort()).toEqual(['decision_maker', 'super_admin'])
    expect(ROLES.filter(roleRequiresMfa).sort()).toEqual(['decision_maker', 'super_admin'])
  })

  it('is satisfied by aal2 for the required roles and by anything for the others', () => {
    expect(mfaSatisfied('super_admin', 'aal1')).toBe(false)
    expect(mfaSatisfied('super_admin', 'aal2')).toBe(true)
    expect(mfaSatisfied('decision_maker', 'aal1')).toBe(false)
    expect(mfaSatisfied('ops_reviewer', 'aal1')).toBe(true)
    expect(mfaSatisfied('finance_approver', 'aal1')).toBe(true)
  })

  it('reads assurance levels strictly', () => {
    expect(isAssuranceLevel('aal1')).toBe(true)
    expect(isAssuranceLevel('aal2')).toBe(true)
    expect(isAssuranceLevel('AAL2')).toBe(false)
    expect(isAssuranceLevel(undefined)).toBe(false)
  })

  it('matches role_requires_mfa() in migration 0011', () => {
    const sql = readFileSync(resolve(__dirname, '../../../supabase/migrations/0011_mfa.sql'), 'utf8')
    const m = sql.match(/select r in \(([^)]*)\)/)
    expect(m).not.toBeNull()
    const inSql = [...(m?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort()
    expect(inSql).toEqual([...MFA_REQUIRED_ROLES].sort())
  })
})
