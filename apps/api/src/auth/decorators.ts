import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common'
import type { Permission } from '@beyondx/shared'
import type { RequestWithStaff, StaffContext } from './staff-context'

export const IS_PUBLIC = 'isPublic'
export const ANY_STAFF = 'anyStaff'
export const REQUIRED_PERMISSIONS = 'requiredPermissions'

/** No sign in needed. Use only for health checks. */
export const Public = () => SetMetadata(IS_PUBLIC, true)

/** Any active staff member may call this route, whatever their role. */
export const AnyStaff = () => SetMetadata(ANY_STAFF, true)

/** The caller must hold every listed permission. */
export const RequirePermissions = (...permissions: Permission[]) => SetMetadata(REQUIRED_PERMISSIONS, permissions)

export const CurrentStaff = createParamDecorator((_data: unknown, ctx: ExecutionContext): StaffContext => {
  const req = ctx.switchToHttp().getRequest<RequestWithStaff>()
  if (!req.staff) throw new Error('CurrentStaff used on a route that is not guarded')
  return req.staff
})
