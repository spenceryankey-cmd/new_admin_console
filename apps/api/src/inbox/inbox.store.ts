import { Injectable } from '@nestjs/common'
import type { InboxStatus, NotificationSendRecord } from '@beyondx/shared'
import { SupabaseService } from '../supabase/supabase.service'
import { StoreError } from '../xperts/xpert.store'
import type { InboxStateRow, InboxStore } from './inbox.ports'

type Row = Record<string, any>
const fail = (what: string, error: { message: string } | null): never => {
  throw new StoreError('failed', `${what}: ${error?.message ?? 'unknown error'}`)
}

@Injectable()
export class SupabaseInboxStore implements InboxStore {
  constructor(private readonly supabase: SupabaseService) {}
  private get db() {
    return this.supabase.admin
  }

  async states() {
    // Only messages someone has touched have a row, so this stays small.
    const { data, error } = await this.db.from('inbox_state').select('message_ref,status,note,handled_by,handled_at').range(0, 9999)
    if (error) fail('Could not read the inbox records', error)
    return new Map<string, InboxStateRow>((data ?? []).map((r: Row) => [r.message_ref, { status: r.status as InboxStatus, note: r.note, handledBy: r.handled_by, handledAt: r.handled_at }]))
  }

  async setState(ref: string, i: { status: InboxStatus; note: string | null; reason: string }, actorId: string) {
    const handled = i.status === 'handled'
    const { error } = await this.db.from('inbox_state').upsert(
      {
        message_ref: ref,
        status: i.status,
        note: i.note,
        handled_by: handled ? actorId : null,
        handled_at: handled ? new Date().toISOString() : null,
        updated_by: actorId,
        change_reason: i.reason,
      },
      { onConflict: 'message_ref' },
    )
    if (error) fail('Could not save that', error)
  }

  private toSend(r: Row, names: Map<string, string>): NotificationSendRecord {
    return {
      id: r.id, audienceKind: r.audience_kind, audienceDetail: r.audience_detail, body: r.body, recipientCount: r.recipient_count,
      deliveredCount: r.delivered_count, status: r.status, error: r.error, sentByName: names.get(r.sent_by) ?? null, createdAt: r.created_at,
    }
  }

  async recordSend(i: Parameters<InboxStore['recordSend']>[0], actorId: string) {
    const { data, error } = await this.db
      .from('notification_send')
      .insert({
        audience_kind: i.audienceKind, audience_detail: i.audienceDetail, body: i.body, recipient_count: i.recipientCount,
        delivered_count: i.deliveredCount, status: i.status, error: i.error, sent_by: actorId, updated_by: actorId, change_reason: 'Sent from the console',
      })
      .select('*')
      .single()
    if (error || !data) fail('Could not record the notification', error)
    return this.toSend(data as Row, await this.staffNames([actorId]))
  }

  async listSends(f: { limit: number; offset: number }) {
    const { data, error, count } = await this.db.from('notification_send').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range(f.offset, f.offset + f.limit - 1)
    if (error) fail('Could not read the send history', error)
    const rows = (data ?? []) as Row[]
    const names = await this.staffNames(rows.map((r) => r.sent_by))
    return { rows: rows.map((r) => this.toSend(r, names)), total: count ?? rows.length }
  }

  async staffNames(ids: (string | null)[]) {
    const list = [...new Set(ids.filter((x): x is string => !!x))]
    if (list.length === 0) return new Map<string, string>()
    const { data, error } = await this.db.from('staff_profile').select('user_id,full_name').in('user_id', list)
    if (error) fail('Could not read staff names', error)
    return new Map<string, string>((data ?? []).map((r: Row) => [r.user_id, r.full_name]))
  }
}
