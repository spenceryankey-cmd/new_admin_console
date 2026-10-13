import { Injectable } from '@nestjs/common'
import { PERMISSIONS, isPermission, isRole, type Permission } from '@beyondx/shared'
import { SupabaseService } from '../supabase/supabase.service'
import type { StaffContext } from './staff-context'

export interface StaffLoader {
  loadStaff(userId: string): Promise<StaffContext | null>
  /** Optional: remember that this person has used a second factor. */
  noteMfa?(userId: string): Promise<void>
}

@Injectable()
export class AccessService implements StaffLoader {
  private readonly mfaNoted = new Set<string>()

  constructor(private readonly supabase: SupabaseService) {}

  /** Stamps staff_profile.mfa_enrolled_at the first time a second factor session is seen. Best effort. */
  async noteMfa(userId: string): Promise<void> {
    if (this.mfaNoted.has(userId)) return
    this.mfaNoted.add(userId)
    const { error } = await this.supabase.admin
      .from('staff_profile')
      .update({ mfa_enrolled_at: new Date().toISOString(), change_reason: 'First sign in with an authenticator code' })
      .eq('user_id', userId)
      .is('mfa_enrolled_at', null)
    if (error) this.mfaNoted.delete(userId)
  }

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
