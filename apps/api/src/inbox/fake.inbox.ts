import { randomUUID } from 'node:crypto'
import type { InboxStatus, NotificationAudience, NotificationRecipient, NotificationSendRecord, RawInboxMessage } from '@beyondx/shared'
import type { InboxSource, InboxStateRow, InboxStore, NotificationSink } from './inbox.ports'

/** In memory stand ins for tests and the development mock. Never used in production. */
export class FakeInboxSource implements InboxSource {
  constructor(public messages: RawInboxMessage[] = []) {}
  async recent(limit: number) {
    return this.messages.slice(0, limit)
  }
}

export class FakeNotificationSink implements NotificationSink {
  delivered: { to: NotificationRecipient[]; body: string }[] = []
  failNext = false
  /** Deliver to only this many people (to test a partial send). */
  deliverOnly: number | null = null
  constructor(public xperts: (NotificationRecipient & { categories?: string[] })[] = [], public employers: NotificationRecipient[] = []) {}

  async resolve(a: NotificationAudience): Promise<NotificationRecipient[]> {
    const strip = (r: NotificationRecipient & { categories?: string[] }): NotificationRecipient => ({ id: r.id, name: r.name })
    switch (a.kind) {
      case 'xpert': return this.xperts.filter((x) => x.id === a.id).map(strip)
      case 'employer': return this.employers.filter((x) => x.id === a.id)
      case 'all_xperts': return this.xperts.map(strip)
      case 'all_employers': return [...this.employers]
      case 'xperts_in_category': return this.xperts.filter((x) => x.categories?.includes(a.category)).map(strip)
    }
  }

  async deliver(to: NotificationRecipient[], body: string) {
    if (this.failNext) {
      this.failNext = false
      throw new Error('The notification service did not answer')
    }
    const n = this.deliverOnly === null ? to.length : Math.min(this.deliverOnly, to.length)
    this.delivered.push({ to: to.slice(0, n), body })
    return { delivered: n }
  }
}

export class FakeInboxStore implements InboxStore {
  state = new Map<string, InboxStateRow>()
  sends: NotificationSendRecord[] = []
  async states() {
    return new Map(this.state)
  }
  async setState(ref: string, i: { status: InboxStatus; note: string | null; reason: string }, actorId: string) {
    const handled = i.status === 'handled'
    this.state.set(ref, { status: i.status, note: i.note, handledBy: handled ? actorId : null, handledAt: handled ? new Date().toISOString() : null })
  }
  async recordSend(i: Parameters<InboxStore['recordSend']>[0], actorId: string) {
    const rec: NotificationSendRecord = { id: randomUUID(), ...i, sentByName: actorId === 'u1' ? 'Test Staff' : null, createdAt: new Date().toISOString() }
    this.sends.unshift(rec)
    return rec
  }
  async listSends(f: { limit: number; offset: number }) {
    return { rows: this.sends.slice(f.offset, f.offset + f.limit), total: this.sends.length }
  }
  async staffNames(ids: (string | null)[]) {
    return new Map(ids.filter((x): x is string => !!x).map((x) => [x, x === 'u1' ? 'Test Staff' : 'Staff'] as [string, string]))
  }
}
