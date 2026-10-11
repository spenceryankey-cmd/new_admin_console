import { Body, Controller, Get, Param, Put } from '@nestjs/common'
import {
  permissionParam,
  roleParam,
  setRolePermissionSchema,
  type Permission,
  type Role,
  type SetRolePermissionInput,
} from '@beyondx/shared'
import { CurrentStaff, RequirePermissions } from '../auth/decorators'
import type { StaffContext } from '../auth/staff-context'
import { ZodPipe } from '../common/zod.pipe'
import { RolesService } from './roles.service'

@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get('permissions')
  @RequirePermissions('staff.read')
  matrix() {
    return this.roles.matrix().then((rows) => ({ rows }))
  }

  @Put(':role/permissions/:permission')
  @RequirePermissions('staff.manage')
  set(
    @CurrentStaff() actor: StaffContext,
    @Param('role', new ZodPipe(roleParam)) role: Role,
    @Param('permission', new ZodPipe(permissionParam)) permission: Permission,
    @Body(new ZodPipe(setRolePermissionSchema)) body: SetRolePermissionInput,
  ) {
    return this.roles.set(actor, role, permission, body).then((row) => ({ row }))
  }
}
