import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common'
import {
  inviteStaffSchema,
  updateStaffSchema,
  type InviteStaffInput,
  type UpdateStaffInput,
} from '@beyondx/shared'
import { CurrentStaff, RequirePermissions } from '../auth/decorators'
import type { StaffContext } from '../auth/staff-context'
import { ZodPipe } from '../common/zod.pipe'
import { StaffService } from './staff.service'

@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  @RequirePermissions('staff.read')
  list() {
    return this.staff.list().then((members) => ({ staff: members }))
  }

  @Post('invite')
  @RequirePermissions('staff.manage')
  invite(@CurrentStaff() actor: StaffContext, @Body(new ZodPipe(inviteStaffSchema)) body: InviteStaffInput) {
    return this.staff.invite(actor, body).then((member) => ({ staff: member }))
  }

  @Patch(':userId')
  @RequirePermissions('staff.manage')
  update(
    @CurrentStaff() actor: StaffContext,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body(new ZodPipe(updateStaffSchema)) body: UpdateStaffInput,
  ) {
    return this.staff.update(actor, userId, body).then((member) => ({ staff: member }))
  }
}
