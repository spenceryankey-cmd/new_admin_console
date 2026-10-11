import 'reflect-metadata'
import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { describe, expect, it } from 'vitest'
import { AnyStaff, Public, RequirePermissions } from './auth/decorators'
import { AuthGuard, type TokenVerifier } from './auth/auth.guard'
import type { StaffLoader } from './auth/access.service'
import type { RequestWithStaff, StaffContext } from './auth/staff-context'
import { loadEnv } from './config/env'
import { PermissionsGuard } from './rbac/permissions.guard'
import { assertStaffChangeAllowed } from './staff/staff.rules'

// Throwaway controllers that carry the decorators under test.
class Open {
  @Public() health() {}
  @AnyStaff() me() {}
  @RequirePermissions('quotes.signoff') signoff() {}
  @RequirePermissions('xperts.read', 'quotes.read') both() {}
  forgotten() {}
}

function ctx(method: keyof Open, req: RequestWithStaff): ExecutionContext {
  return {
    getHandler: () => Open.prototype[method],
    getClass: () => Open,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext
}

function staff(role: StaffContext['role'], permissions: StaffContext['permissions'] = new Set()): StaffContext {
  return { userId: 'u1', email: 'a@b.co', fullName: 'A B', role, isActive: true, permissions }
}

describe('PermissionsGuard', () => {
  const guard = new PermissionsGuard(new Reflector())

  it('lets public routes through without a staff member', () => {
    expect(guard.canActivate(ctx('health', { headers: {} }))).toBe(true)
  })

  it('lets any active staff member call an AnyStaff route', () => {
    expect(guard.canActivate(ctx('me', { headers: {}, staff: staff('finance_approver') }))).toBe(true)
  })

  it('requires the named permission', () => {
    const ok = staff('finance_approver', new Set(['quotes.signoff']))
    const no = staff('ops_reviewer', new Set(['quotes.read']))
    expect(guard.canActivate(ctx('signoff', { headers: {}, staff: ok }))).toBe(true)
    expect(() => guard.canActivate(ctx('signoff', { headers: {}, staff: no }))).toThrow(ForbiddenException)
  })

  it('requires every listed permission', () => {
    const half = staff('ops_reviewer', new Set(['xperts.read']))
    expect(() => guard.canActivate(ctx('both', { headers: {}, staff: half }))).toThrow(ForbiddenException)
  })

  it('lets super_admin through any permission route', () => {
    expect(guard.canActivate(ctx('signoff', { headers: {}, staff: staff('super_admin') }))).toBe(true)
  })

  it('refuses a route with no access decorator, even for super_admin', () => {
    expect(() => guard.canActivate(ctx('forgotten', { headers: {}, staff: staff('super_admin') }))).toThrow(ForbiddenException)
  })

  it('refuses when no staff member is attached', () => {
    expect(() => guard.canActivate(ctx('signoff', { headers: {} }))).toThrow(ForbiddenException)
  })
})

describe('AuthGuard', () => {
  const verifier = (id: string | null): TokenVerifier => ({ verify: async () => id })
  const loader = (s: StaffContext | null): StaffLoader => ({ loadStaff: async () => s })
  const make = (id: string | null, s: StaffContext | null) => new AuthGuard(new Reflector(), verifier(id), loader(s))

  it('skips public routes', async () => {
    expect(await make(null, null).canActivate(ctx('health', { headers: {} }))).toBe(true)
  })

  it('rejects a missing token', async () => {
    await expect(make('u1', staff('super_admin')).canActivate(ctx('me', { headers: {} }))).rejects.toThrow(UnauthorizedException)
  })

  it('rejects an invalid token', async () => {
    const req: RequestWithStaff = { headers: { authorization: 'Bearer nope' } }
    await expect(make(null, null).canActivate(ctx('me', req))).rejects.toThrow(UnauthorizedException)
  })

  it('rejects a signed in user who is not staff, such as an employer', async () => {
    const req: RequestWithStaff = { headers: { authorization: 'Bearer ok' } }
    await expect(make('emp', null).canActivate(ctx('me', req))).rejects.toThrow(ForbiddenException)
  })

  it('rejects a deactivated staff member', async () => {
    const req: RequestWithStaff = { headers: { authorization: 'Bearer ok' } }
    const inactive = { ...staff('ops_reviewer'), isActive: false }
    await expect(make('u1', inactive).canActivate(ctx('me', req))).rejects.toThrow(ForbiddenException)
  })

  it('attaches the staff member for an active account', async () => {
    const req: RequestWithStaff = { headers: { authorization: 'Bearer ok' } }
    expect(await make('u1', staff('ops_reviewer')).canActivate(ctx('me', req))).toBe(true)
    expect(req.staff?.role).toBe('ops_reviewer')
  })
})

describe('assertStaffChangeAllowed', () => {
  const target = { userId: 't1', role: 'ops_reviewer' as const, isActive: true }

  it('lets one admin change another person', () => {
    expect(() => assertStaffChangeAllowed('a1', target, { role: 'decision_maker' }, 2)).not.toThrow()
  })

  it('blocks changing your own role or deactivating yourself', () => {
    expect(() => assertStaffChangeAllowed('t1', target, { role: 'super_admin' }, 2)).toThrow()
    expect(() => assertStaffChangeAllowed('t1', target, { isActive: false }, 2)).toThrow()
  })

  it('keeps at least one active super admin', () => {
    const root = { userId: 'r1', role: 'super_admin' as const, isActive: true }
    expect(() => assertStaffChangeAllowed('a1', root, { role: 'ops_reviewer' }, 1)).toThrow()
    expect(() => assertStaffChangeAllowed('a1', root, { isActive: false }, 1)).toThrow()
    expect(() => assertStaffChangeAllowed('a1', root, { isActive: false }, 2)).not.toThrow()
  })
})

describe('loadEnv', () => {
  const good = {
    SUPABASE_URL: 'https://abc.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'x'.repeat(40),
    WEB_APP_URL: 'https://admin.example.com',
    XPERT_TABLE: 'xpert_records',
  }
  it('accepts a complete environment and defaults the port', () => {
    expect(loadEnv(good).PORT).toBe(3000)
  })
  it('requires the Xpert table name rather than guessing it', () => {
    const { XPERT_TABLE: _omit, ...without } = good
    expect(() => loadEnv(without)).toThrow(/XPERT_TABLE/)
  })
  it('refuses table names that are not plain identifiers', () => {
    expect(() => loadEnv({ ...good, XPERT_TABLE: 'x; drop table y' })).toThrow(/XPERT_TABLE/)
  })
  it('treats an empty optional variable as unset', () => {
    expect(loadEnv({ ...good, XPERT_AREA_COLUMN: '' }).XPERT_AREA_COLUMN).toBeUndefined()
  })
  it('fails fast with a readable message', () => {
    expect(() => loadEnv({ ...good, SUPABASE_URL: 'nope' })).toThrow(/Invalid environment/)
  })
})
