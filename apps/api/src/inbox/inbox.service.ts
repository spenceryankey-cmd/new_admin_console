import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import {
  INBOX_READ_LIMIT,
  type HandleInboxInput,
  type InboxCounts,
  type InboxListQuery,
  type InboxMessage,
  type RawInboxMessage,
} from '@beyondx/shared'
import { AuditService } from '../audit/audit.service'
import type { StaffContext } from '../auth/staff-context'
import { INBOX_SOURCE, INBOX_STORE, type InboxSource, type InboxStore } from './inbox.ports'

@Injectable()
export class InboxService {
  constructor(
    @Inject(INBOX_SOURCE) private readonly source: InboxSource,
    @Inject(INBOX_STORE) private readonly store: InboxStore,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private async load(): Promise<InboxMessage[]> {
    const [raw, states] = await Promise.all([this.source.recent(INBOX_READ_LIMIT), this.store.states()])
    const names = await this.store.staffNames([...states.values()].map((s) => s.handledBy))
    return [...raw]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((m: RawInboxMessage) => {
        const s = states.get(m.ref)
        return {
          ...m,
          status: s?.status ?? 'open',
          note: s?.note ?? null,
          handledByName: s?.handledBy ? (names.get(s.handledBy) ?? null) : null,
          handledAt: s?.handledAt ?? null,
        }
      })
  }

  async list(q: InboxListQuery) {
    const all = await this.load()
    const needle = q.q?.toLowerCase()
    const rows = all.filter(
      (m) =>
        (q.status === 'all' || m.status === q.status) &&
        (!needle || [m.name, m.phone, m.type, m.body].some((v) => v?.toLowerCase().includes(needle))),
    )
    return { messages: rows.slice(q.offset, q.offset + q.limit), total: rows.length }
  }

  async counts(): Promise<InboxCounts> {
    const all = await this.load()
    const open = all.filter((m) => m.status === 'open').length
    return { open, handled: all.length - open, total: all.length }
  }

  async handle(actor: StaffContext, ref: string, i: HandleInboxInput): Promise<InboxMessage> {
    const current = (await this.load()).find((m) => m.ref === ref)
    if (!current) throw new NotFoundException('That message was not found.')
    await this.store.setState(ref, { status: i.status, note: i.note?.trim() || null, reason: i.reason }, actor.userId)
    await this.audit.record(actor, { action: i.status === 'handled' ? 'inbox.handled' : 'inbox.reopened', entityType: 'inbox_state', entityId: ref, reason: i.reason })
    const after = (await this.load()).find((m) => m.ref === ref)
    return after ?? current
  }
}
