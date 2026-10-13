import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { MFA_REQUIRED_CODE, MFA_REQUIRED_MESSAGE, mfaSatisfied } from '@beyondx/shared'
import { ALLOW_WITHOUT_MFA, IS_PUBLIC } from './decorators'
import { AccessService, type StaffLoader } from './access.service'
import type { RequestWithStaff } from './staff-context'
import { TOKEN_VERIFIER, type TokenVerifier } from './token.verifier'

export { TOKEN_VERIFIER, type TokenVerifier } from './token.verifier'

/**
 * Runs on every route. Verifies the Supabase access token on this server, then requires an
 * active staff_profile. An employer or Xpert who has a Supabase account on the main site can sign in
 * to Supabase but gets nothing here. Roles that must use a second factor are refused everywhere except
 * the routes marked AllowWithoutMfa until their session has passed the authenticator code.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(TOKEN_VERIFIER) private readonly tokens: TokenVerifier,
    @Inject(AccessService) private readonly access: StaffLoader,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true

    const req = ctx.switchToHttp().getRequest<RequestWithStaff>()
    const header = req.headers.authorization
    const value = Array.isArray(header) ? header[0] : header
    const token = value?.startsWith('Bearer ') ? value.slice(7).trim() : ''
    if (!token) throw new UnauthorizedException('Sign in to continue')

    const verified = await this.tokens.verify(token)
    if (!verified) throw new UnauthorizedException('Your session has expired. Sign in again.')

    const staff = await this.access.loadStaff(verified.userId)
    if (!staff) throw new ForbiddenException('This account is not set up for the admin console')
    if (!staff.isActive) throw new ForbiddenException('This account has been deactivated')

    const satisfied = mfaSatisfied(staff.role, verified.aal)
    const exempt = this.reflector.getAllAndOverride<boolean>(ALLOW_WITHOUT_MFA, [ctx.getHandler(), ctx.getClass()])
    if (!satisfied && !exempt) {
      throw new ForbiddenException({ statusCode: 403, error: 'Forbidden', message: MFA_REQUIRED_MESSAGE, code: MFA_REQUIRED_CODE })
    }
    if (satisfied && verified.aal === 'aal2') void this.access.noteMfa?.(verified.userId)

    req.staff = { ...staff, aal: verified.aal }
    return true
  }
}
