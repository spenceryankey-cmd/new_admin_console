import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { can, type Permission } from '@beyondx/shared'
import { ANY_STAFF, IS_PUBLIC, REQUIRED_PERMISSIONS } from '../auth/decorators'
import type { RequestWithStaff } from '../auth/staff-context'

/**
 * Secure by default: a route must say who may call it. With no @Public(),
 * @AnyStaff() or @RequirePermissions(...), the request is refused. That way a
 * forgotten decorator can never leave a route open.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly log = new Logger(PermissionsGuard.name)

  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const targets = [ctx.getHandler(), ctx.getClass()]
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true

    const req = ctx.switchToHttp().getRequest<RequestWithStaff>()
    const staff = req.staff
    if (!staff) throw new ForbiddenException('Not allowed')

    const needed = this.reflector.getAllAndOverride<Permission[] | undefined>(REQUIRED_PERMISSIONS, targets)
    if (needed && needed.length > 0) {
      if (can(staff, needed)) return true
      throw new ForbiddenException('Your role does not allow this action')
    }

    if (this.reflector.getAllAndOverride<boolean>(ANY_STAFF, targets)) return true

    this.log.error(`Route ${ctx.getClass().name}.${ctx.getHandler().name} has no access decorator, refusing`)
    throw new ForbiddenException('Not allowed')
  }
}
