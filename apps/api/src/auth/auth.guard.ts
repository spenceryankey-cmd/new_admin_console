import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { IS_PUBLIC } from './decorators'
import { AccessService, type StaffLoader } from './access.service'
import type { RequestWithStaff } from './staff-context'
import { SupabaseService } from '../supabase/supabase.service'

export interface TokenVerifier {
  verify(token: string): Promise<string | null>
}

@Injectable()
export class SupabaseTokenVerifier implements TokenVerifier {
  constructor(private readonly supabase: SupabaseService) {}

  async verify(token: string): Promise<string | null> {
    const { data, error } = await this.supabase.admin.auth.getUser(token)
    return error || !data.user ? null : data.user.id
  }
}

export const TOKEN_VERIFIER = Symbol('TOKEN_VERIFIER')

/**
 * Runs on every route. Verifies the Supabase access token, then requires an
 * active staff_profile. An employer or Xpert who has a Supabase account on the
 * main site can sign in to Supabase but gets nothing here.
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

    const userId = await this.tokens.verify(token)
    if (!userId) throw new UnauthorizedException('Your session has expired. Sign in again.')

    const staff = await this.access.loadStaff(userId)
    if (!staff) throw new ForbiddenException('This account is not set up for the admin console')
    if (!staff.isActive) throw new ForbiddenException('This account has been deactivated')

    req.staff = staff
    return true
  }
}
