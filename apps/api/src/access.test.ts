import 'reflect-metadata'
import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { describe, expect, it } from 'vitest'
import { AllowWithoutMfa, AnyStaff, Public, RequirePermissions } from './auth/decorators'
import { AuthGuard, type TokenVerifier } from './auth/auth.guard'
import type { AssuranceLevel } from '@beyondx/shared'
import type { StaffLoader } from './auth/access.service'
import type { RequestWithStaff, StaffContext } from './auth/staff-context'
import { loadEnv } from './config/env'
import { PermissionsGuard } from './rbac/permissions.guard'
import { assertStaffChangeAllowed } from './staff/staff.rules'

// Throwaway controllers that carry the decorators under test.
class Open {
  @Public() health() {}
  @AnyStaff() me() {}
  @AnyStaff() @AllowWithoutMfa() whoAmI() {}
  @RequirePermissions('payments.record') recordPayment() {}
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
    const ok = staff('finance_approver', new Set(['payments.record']))
    const no = staff('ops_reviewer', new Set(['quotes.read']))
    expect(guard.canActivate(ctx('recordPayment', { headers: {}, staff: ok }))).toBe(true)
    expect(() => guard.canActivate(ctx('recordPayment', { headers: {}, staff: no }))).toThrow(ForbiddenException)
  })

  it('requires every listed permission', () => {
    const half = staff('ops_reviewer', new Set(['xperts.read']))
    expect(() => guard.canActivate(ctx('both', { headers: {}, staff: half }))).toThrow(ForbiddenException)
  })

  it('lets super_admin through any permission route', () => {
    expect(guard.canActivate(ctx('recordPayment', { headers: {}, staff: staff('super_admin') }))).toBe(true)
  })

  it('refuses a route with no access decorator, even for super_admin', () => {
    expect(() => guard.canActivate(ctx('forgotten', { headers: {}, staff: staff('super_admin') }))).toThrow(ForbiddenException)
  })

  it('refuses when no staff member is attached', () => {
    expect(() => guard.canActivate(ctx('recordPayment', { headers: {} }))).toThrow(ForbiddenException)
  })
})

describe('AuthGuard', () => {
  const verifier = (id: string | null, aal: AssuranceLevel = 'aal1'): TokenVerifier => ({ verify: async () => (id ? { userId: id, aal } : null) })
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

  describe('second factor', () => {
    const req = (): RequestWithStaff => ({ headers: { authorization: 'Bearer ok' } })
    const gate = (role: StaffContext['role'], aal: AssuranceLevel, noted: string[] = []) =>
      new AuthGuard(new Reflector(), verifier('u1', aal), { loadStaff: async () => staff(role), noteMfa: async (id) => void noted.push(id) })

    it('refuses a super admin who has only passed the password step, with a code the web app can read', async () => {
      const e = await gate('super_admin', 'aal1').canActivate(ctx('me', req())).catch((x) => x)
      expect(e).toBeInstanceOf(ForbiddenException)
      expect(e.getResponse()).toMatchObject({ code: 'mfa_required' })
    })

    it('refuses a decision maker who has only passed the password step', async () => {
      await expect(gate('decision_maker', 'aal1').canActivate(ctx('recordPayment', req()))).rejects.toThrow(ForbiddenException)
    })

    it('lets the sign in screen ask who it is before the code is entered, but does not attach any rights', async () => {
      const r = req()
      expect(await gate('super_admin', 'aal1').canActivate(ctx('whoAmI', r))).toBe(true)
      expect(r.staff?.aal).toBe('aal1')
    })

    it('lets them in once the authenticator code has been entered, and notes it', async () => {
      const noted: string[] = []
      expect(await gate('super_admin', 'aal2', noted).canActivate(ctx('me', req()))).toBe(true)
      expect(noted).toEqual(['u1'])
    })

    it('does not ask other roles for a code', async () => {
      expect(await gate('ops_reviewer', 'aal1').canActivate(ctx('me', req()))).toBe(true)
      expect(await gate('finance_approver', 'aal1').canActivate(ctx('me', req()))).toBe(true)
    })

    it('still refuses a missing, bad or non staff session before it looks at the second factor', async () => {
      await expect(new AuthGuard(new Reflector(), verifier(null), loader(staff('super_admin'))).canActivate(ctx('whoAmI', req()))).rejects.toThrow(UnauthorizedException)
      await expect(new AuthGuard(new Reflector(), verifier('u1', 'aal1'), loader(null)).canActivate(ctx('whoAmI', req()))).rejects.toThrow(ForbiddenException)
    })
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
    HETZNER_DATABASE_URL: 'postgres://console_reader:pw@db.internal:5432/hetzner',
    HETZNER_WRITE_DATABASE_URL: 'postgres://console_writer:pw@db.internal:5432/hetzner',
  }
  it('accepts a complete environment and defaults the port and TLS mode', () => {
    const env = loadEnv(good)
    expect(env.PORT).toBe(3000)
    expect(env.HETZNER_SSL).toBe('require')
  })
  it('requires both database connections rather than guessing them', () => {
    const { HETZNER_DATABASE_URL: _r, ...noRead } = good
    const { HETZNER_WRITE_DATABASE_URL: _w, ...noWrite } = good
    expect(() => loadEnv(noRead)).toThrow(/HETZNER_DATABASE_URL/)
    expect(() => loadEnv(noWrite)).toThrow(/HETZNER_WRITE_DATABASE_URL/)
  })
  it('refuses a connection value that is not a postgres connection string', () => {
    expect(() => loadEnv({ ...good, HETZNER_DATABASE_URL: 'mysql://x' })).toThrow(/HETZNER_DATABASE_URL/)
  })
  it('only accepts the known TLS modes', () => {
    expect(loadEnv({ ...good, HETZNER_SSL: 'disable' }).HETZNER_SSL).toBe('disable')
    expect(() => loadEnv({ ...good, HETZNER_SSL: 'maybe' })).toThrow(/HETZNER_SSL/)
  })
  it('treats an empty optional variable as unset', () => {
    expect(loadEnv({ ...good, HETZNER_CA_CERT: '' }).HETZNER_CA_CERT).toBeUndefined()
  })
  it('fails fast with a readable message', () => {
    expect(() => loadEnv({ ...good, SUPABASE_URL: 'nope' })).toThrow(/Invalid environment/)
  })
})
