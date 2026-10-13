import { BadRequestException, ConflictException, HttpException, HttpStatus, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common'
import {
  NOTIFICATION_SENDS_PER_HOUR,
  describeAudience,
  type NotificationAudience,
  type NotificationPreview,
  type NotificationSendRecord,
  type SendNotificationInput,
} from '@beyondx/shared'
import { AuditService } from '../audit/audit.service'
import type { StaffContext } from '../auth/staff-context'
import { INBOX_STORE, NOTIFICATION_SINK, type InboxStore, type NotificationSink } from './inbox.ports'

const HOUR = 3_600_000

@Injectable()
export class NotificationsService {
  /** Send times per person in the last hour. Per process, which is enough for one Railway instance. */
  private readonly recent = new Map<string, number[]>()
  now: () => number = Date.now

  constructor(
    @Inject(NOTIFICATION_SINK) private readonly sink: NotificationSink,
    @Inject(INBOX_STORE) private readonly store: InboxStore,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async preview(audience: NotificationAudience): Promise<NotificationPreview> {
    const people = await this.sink.resolve(audience)
    return { recipients: people.length, sample: people.slice(0, 5).map((p) => p.name ?? p.id) }
  }

  private takeSlot(userId: string) {
    const t = this.now()
    const cutoff = t - HOUR
    const times = (this.recent.get(userId) ?? []).filter((x) => x > cutoff)
    if (times.length >= NOTIFICATION_SENDS_PER_HOUR) {
      throw new HttpException(`You can send ${NOTIFICATION_SENDS_PER_HOUR} notifications an hour. Try again later.`, HttpStatus.TOO_MANY_REQUESTS)
    }
    times.push(t)
    this.recent.set(userId, times)
  }

  async send(actor: StaffContext, i: SendNotificationInput): Promise<NotificationSendRecord> {
    this.takeSlot(actor.userId)
    const people = await this.sink.resolve(i.audience)
    if (people.length === 0) throw new BadRequestException('No one matches that audience, so nothing was sent.')
    if (people.length !== i.confirmRecipients) {
      throw new ConflictException(`The audience changed from ${i.confirmRecipients} to ${people.length} people. Check it and confirm again.`)
    }

    let delivered = 0
    let error: string | null = null
    try {
      delivered = (await this.sink.deliver(people, i.body)).delivered
    } catch (e) {
      error = e instanceof Error ? e.message.slice(0, 300) : 'Delivery failed'
    }
    const status = error !== null || delivered === 0 ? 'failed' : delivered === people.length ? 'sent' : 'partial'
    const rec = await this.store.recordSend(
      {
        audienceKind: i.audience.kind,
        audienceDetail: i.audience.kind === 'xpert' || i.audience.kind === 'employer' ? i.audience.id : i.audience.kind === 'xperts_in_category' ? i.audience.category : null,
        body: i.body,
        recipientCount: people.length,
        deliveredCount: Math.min(delivered, people.length),
        status,
        error: status === 'partial' ? 'Not every notification was delivered.' : error,
      },
      actor.userId,
    )
    await this.audit.record(actor, {
      action: 'notification.sent',
      entityType: 'notification_send',
      entityId: rec.id,
      reason: describeAudience(i.audience),
      metadata: { body: i.body, recipients: people.length, delivered: rec.deliveredCount, status },
    })
    if (status === 'failed') throw new ServiceUnavailableException('The notification could not be delivered. It has been recorded as failed. Try again in a moment.')
    return rec
  }

  history(f: { limit: number; offset: number }) {
    return this.store.listSends(f).then(({ rows, total }) => ({ sends: rows, total }))
  }
}
