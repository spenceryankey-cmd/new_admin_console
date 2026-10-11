import { BadRequestException, Injectable } from '@nestjs/common'
import { isPermission, isRole, type Permission, type Role, type RolePermissionRow, type SetRolePermissionInput } from '@beyondx/shared'
import { SupabaseService } from '../supabase/supabase.service'
import type { StaffContext } from '../auth/staff-context'

@Injectable()
export class RolesService {
  constructor(private readonly supabase: SupabaseService) {}

  async matrix(): Promise<RolePermissionRow[]> {
    const { data, error } = await this.supabase.admin.from('role_permission').select('role,permission,granted')
    if (error) throw new Error(`Could not read role permissions: ${error.message}`)
    return (data ?? []).flatMap((r) =>
      isRole(r.role) && isPermission(r.permission) ? [{ role: r.role, permission: r.permission, granted: r.granted }] : [],
    )
  }

  /** Grant or revoke one permission for a role. Rows are never deleted. */
  async set(actor: StaffContext, role: Role, permission: Permission, input: SetRolePermissionInput): Promise<RolePermissionRow> {
    if (role === 'super_admin') {
      throw new BadRequestException('Super admin always holds every permission and cannot be edited.')
    }
    const { data, error } = await this.supabase.admin
      .from('role_permission')
      .upsert(
        { role, permission, granted: input.granted, updated_by: actor.userId, change_reason: input.reason },
        { onConflict: 'role,permission' },
      )
      .select('role,permission,granted')
      .single()
    if (error) throw new Error(`Could not update role permission: ${error.message}`)
    return { role, permission, granted: data.granted }
  }
}
