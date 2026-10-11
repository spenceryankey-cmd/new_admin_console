import { Injectable } from '@nestjs/common'
import type { AuditEntry, AuditQuery } from '@beyondx/shared'
import { SupabaseService } from '../supabase/supabase.service'
import type { StaffContext } from '../auth/staff-context'

type AuditRow = {
  id: number
  occurred_at: string
  actor_id: string | null
  actor_email: string | null
  action: string
  entity_type: string
  entity_id: string
  reason: string | null
  before: unknown
  after: unknown
}

/**
 * Changes to table rows are audited by database triggers (see migration 0001), so
 * they cannot be skipped. This service records the actions that are not a row
 * change, such as a sign in, and reads the log back.
 */
@Injectable()
export class AuditService {
  constructor(private readonly supabase: SupabaseService) {}

  async record(
    actor: Pick<StaffContext, 'userId' | 'email'>,
    event: { action: string; entityType: string; entityId: string; reason?: string; metadata?: Record<string, unknown> },
  ): Promise<void> {
    const { error } = await this.supabase.admin.from('audit_log').insert({
      actor_id: actor.userId,
      actor_email: actor.email,
      action: event.action,
      entity_type: event.entityType,
      entity_id: event.entityId,
      reason: event.reason ?? null,
      metadata: event.metadata ?? null,
    })
    if (error) throw new Error(`Could not write the audit log: ${error.message}`)
  }

  async list(q: AuditQuery): Promise<{ entries: AuditEntry[]; nextBefore: number | null }> {
    let query = this.supabase.admin
      .from('audit_log')
      .select('id,occurred_at,actor_id,actor_email,action,entity_type,entity_id,reason,before,after')
      .order('id', { ascending: false })
      .limit(q.limit + 1)
    if (q.before) query = query.lt('id', q.before)
    if (q.entityType) query = query.eq('entity_type', q.entityType)
    if (q.actorId) query = query.eq('actor_id', q.actorId)

    const { data, error } = await query
    if (error) throw new Error(`Could not read the audit log: ${error.message}`)
    const rows = (data ?? []) as AuditRow[]
    const page = rows.slice(0, q.limit)
    return {
      entries: page.map((r) => ({
        id: r.id,
        occurredAt: r.occurred_at,
        actorId: r.actor_id,
        actorEmail: r.actor_email,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        reason: r.reason,
        before: r.before,
        after: r.after,
      })),
      nextBefore: rows.length > q.limit ? (page[page.length - 1]?.id ?? null) : null,
    }
  }
}
