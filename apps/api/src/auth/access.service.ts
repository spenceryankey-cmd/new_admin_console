import { Injectable } from '@nestjs/common'
import { PERMISSIONS, isPermission, isRole, type Permission } from '@beyondx/shared'
import { SupabaseService } from '../supabase/supabase.service'
import type { StaffContext } from './staff-context'

export interface StaffLoader {
  loadStaff(userId: string): Promise<StaffContext | null>
}

@Injectable()
export class AccessService implements StaffLoader {
  constructor(private readonly supabase: SupabaseService) {}

  async loadStaff(userId: string): Promise<StaffContext | null> {
    const { data: row, error } = await this.supabase.admin
      .from('staff_profile')
      .select('user_id,email,full_name,role,is_active')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) throw new Error(`Could not load staff profile: ${error.message}`)
    if (!row || !isRole(row.role)) return null

    let permissions: Permission[]
    if (row.role === 'super_admin') {
      permissions = [...PERMISSIONS]
    } else {
      const { data: grants, error: grantErr } = await this.supabase.admin
        .from('role_permission')
        .select('permission')
        .eq('role', row.role)
        .eq('granted', true)
      if (grantErr) throw new Error(`Could not load role permissions: ${grantErr.message}`)
      permissions = (grants ?? []).map((g) => g.permission).filter(isPermission)
    }

    return {
      userId: row.user_id,
      email: row.email,
      fullName: row.full_name,
      role: row.role,
      isActive: row.is_active,
      permissions: new Set(permissions),
    }
  }
}
