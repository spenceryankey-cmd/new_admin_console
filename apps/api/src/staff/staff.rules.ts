import { BadRequestException } from '@nestjs/common'
import type { Role, UpdateStaffInput } from '@beyondx/shared'

export type StaffRow = { userId: string; role: Role; isActive: boolean }

/**
 * Safety rules for changing a staff account. Pure so they can be unit tested.
 * activeSuperAdmins counts active super_admin accounts before the change.
 */
export function assertStaffChangeAllowed(
  actorId: string,
  target: StaffRow,
  input: Pick<UpdateStaffInput, 'role' | 'isActive'>,
  activeSuperAdmins: number,
): void {
  const changingRole = input.role !== undefined && input.role !== target.role
  const deactivating = input.isActive === false && target.isActive

  if (actorId === target.userId && (changingRole || deactivating)) {
    throw new BadRequestException('You cannot change your own role or deactivate your own account. Ask another super admin.')
  }

  const losingSuperAdmin =
    target.role === 'super_admin' && target.isActive && (changingRole || deactivating)
  if (losingSuperAdmin && activeSuperAdmins <= 1) {
    throw new BadRequestException('There must always be at least one active super admin.')
  }
}
