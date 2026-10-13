import { Controller, Get, Headers, Post } from '@nestjs/common'
import { mfaSatisfied, roleRequiresMfa, type MeResponse } from '@beyondx/shared'
import { AllowWithoutMfa, AnyStaff, CurrentStaff, Public } from './auth/decorators'
import type { StaffContext } from './auth/staff-context'
import { AuditService } from './audit/audit.service'

@Controller()
export class MeController {
  constructor(private readonly audit: AuditService) {}

  @Public()
  @Get('health')
  health() {
    return { ok: true }
  }

  @AnyStaff()
  @AllowWithoutMfa()
  @Get('me')
  me(@CurrentStaff() s: StaffContext): MeResponse {
    return {
      staff: {
        userId: s.userId,
        email: s.email,
        fullName: s.fullName,
        role: s.role,
        isActive: s.isActive,
      },
      // Nothing is granted until the second factor is done, so the list is empty until then.
      permissions: mfaSatisfied(s.role, s.aal ?? 'aal1') ? [...s.permissions] : [],
      mfa: { required: roleRequiresMfa(s.role), satisfied: mfaSatisfied(s.role, s.aal ?? 'aal1') },
    }
  }

  /** The web app calls this once after a fresh sign in, not on token refresh. */
  @AnyStaff()
  @Post('me/sign-in')
  async signIn(@CurrentStaff() s: StaffContext, @Headers('user-agent') userAgent?: string) {
    await this.audit.record(s, {
      action: 'staff.sign_in',
      entityType: 'staff_profile',
      entityId: s.userId,
      metadata: { userAgent: userAgent?.slice(0, 200) ?? null },
    })
    return { ok: true }
  }
}
