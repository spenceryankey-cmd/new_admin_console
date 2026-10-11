import { BadGatewayException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { isRole, type InviteStaffInput, type StaffMember, type UpdateStaffInput } from '@beyondx/shared'
import { ENV, type Env } from '../config/env'
import { SupabaseService } from '../supabase/supabase.service'
import type { StaffContext } from '../auth/staff-context'
import { assertStaffChangeAllowed } from './staff.rules'

type Row = {
  user_id: string
  email: string
  full_name: string
  role: string
  is_active: boolean
  created_at: string
  updated_at: string
}

const COLUMNS = 'user_id,email,full_name,role,is_active,created_at,updated_at'

function toMember(r: Row): StaffMember {
  if (!isRole(r.role)) throw new Error(`Unknown role in staff_profile: ${r.role}`)
  return {
    userId: r.user_id,
    email: r.email,
    fullName: r.full_name,
    role: r.role,
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

/**
 * Every write sets updated_by and change_reason. A database trigger turns that
 * into an audit_log entry in the same transaction, so there is no way to change a
 * staff account without leaving a record.
 */
@Injectable()
export class StaffService {
  private readonly log = new Logger(StaffService.name)

  constructor(
    private readonly supabase: SupabaseService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async list(): Promise<StaffMember[]> {
    const { data, error } = await this.supabase.admin
      .from('staff_profile')
      .select(COLUMNS)
      .order('created_at', { ascending: true })
    if (error) throw new Error(`Could not list staff: ${error.message}`)
    return (data as Row[]).map(toMember)
  }

  async invite(actor: StaffContext, input: InviteStaffInput): Promise<StaffMember> {
    const existing = await this.supabase.admin.from('staff_profile').select('user_id').ilike('email', input.email).maybeSingle()
    if (existing.error) throw new Error(existing.error.message)
    if (existing.data) throw new ConflictException('That person is already on the staff list')

    const invited = await this.supabase.admin.auth.admin.inviteUserByEmail(input.email, {
      redirectTo: `${this.env.WEB_APP_URL.replace(/\/$/, '')}/set-password`,
      data: { full_name: input.fullName },
    })
    if (invited.error || !invited.data.user) {
      const msg = invited.error?.message ?? 'Unknown error'
      if (/already.*registered|already been registered|exists/i.test(msg)) {
        throw new ConflictException(
          'That email address already has an account, probably an employer on the main site. Use a different email address for staff.',
        )
      }
      this.log.error(`Invite failed for ${input.email}: ${msg}`)
      throw new BadGatewayException('Could not send the invitation. Check the email settings in Supabase and try again.')
    }

    const { data, error } = await this.supabase.admin
      .from('staff_profile')
      .insert({
        user_id: invited.data.user.id,
        email: input.email,
        full_name: input.fullName,
        role: input.role,
        updated_by: actor.userId,
        change_reason: `Invited by ${actor.email}`,
      })
      .select(COLUMNS)
      .single()
    if (error) {
      this.log.error(`Invitation sent to ${input.email} but the staff profile was not saved: ${error.message}`)
      throw new BadGatewayException(
        'The invitation email went out but the staff profile was not saved. Ask the Supabase owner to check this account.',
      )
    }
    return toMember(data as Row)
  }

  async update(actor: StaffContext, userId: string, input: UpdateStaffInput): Promise<StaffMember> {
    const found = await this.supabase.admin.from('staff_profile').select(COLUMNS).eq('user_id', userId).maybeSingle()
    if (found.error) throw new Error(found.error.message)
    if (!found.data) throw new NotFoundException('Staff member not found')
    const target = toMember(found.data as Row)

    const count = await this.supabase.admin
      .from('staff_profile')
      .select('user_id', { count: 'exact', head: true })
      .eq('role', 'super_admin')
      .eq('is_active', true)
    if (count.error) throw new Error(count.error.message)

    assertStaffChangeAllowed(actor.userId, target, input, count.count ?? 0)

    const patch: Record<string, unknown> = { updated_by: actor.userId, change_reason: input.reason }
    if (input.fullName !== undefined) patch.full_name = input.fullName
    if (input.role !== undefined) patch.role = input.role
    if (input.isActive !== undefined) patch.is_active = input.isActive

    const { data, error } = await this.supabase.admin
      .from('staff_profile')
      .update(patch)
      .eq('user_id', userId)
      .select(COLUMNS)
      .single()
    if (error) throw new Error(`Could not update staff: ${error.message}`)
    return toMember(data as Row)
  }
}
