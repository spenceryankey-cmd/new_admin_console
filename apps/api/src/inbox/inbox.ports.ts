import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import type {
  InboxStatus,
  NotificationAudience,
  NotificationRecipient,
  NotificationSendRecord,
  RawInboxMessage,
} from '@beyondx/shared'

/**
 * Where the support messages come from. The main site writes them, so the console only reads them, through a
 * read only database user (the same pattern as the Xpert records). Nothing in the console edits a message.
 */
export interface InboxSource {
  /** The most recent messages, newest first. */
  recent(limit: number): Promise<RawInboxMessage[]>
}
export const INBOX_SOURCE = Symbol('INBOX_SOURCE')

/**
 * How a notification gets to the bell inside the Xpert and employer dashboards on the main site.
 * resolve() says who an audience is, deliver() puts the notification in front of them.
 */
export interface NotificationSink {
  resolve(audience: NotificationAudience): Promise<NotificationRecipient[]>
  deliver(recipients: NotificationRecipient[], body: string): Promise<{ delivered: number }>
}
export const NOTIFICATION_SINK = Symbol('NOTIFICATION_SINK')

const NOT_CONNECTED = 'This is not connected to the main site yet. See docs/PHASE8.md for what the main site needs to provide.'

/** Used until the main site's tables are known and the real source is written. Refuses honestly rather than showing nothing. */
@Injectable()
export class NotConnectedInboxSource implements InboxSource {
  async recent(): Promise<RawInboxMessage[]> {
    throw new ServiceUnavailableException(NOT_CONNECTED)
  }
}

@Injectable()
export class NotConnectedNotificationSink implements NotificationSink {
  async resolve(): Promise<NotificationRecipient[]> {
    throw new ServiceUnavailableException(NOT_CONNECTED)
  }
  async deliver(): Promise<{ delivered: number }> {
    throw new ServiceUnavailableException(NOT_CONNECTED)
  }
}

export type InboxStateRow = { status: InboxStatus; note: string | null; handledBy: string | null; handledAt: string | null }

/** The console's own records: what staff did with each message, and every notification sent. */
export interface InboxStore {
  states(): Promise<Map<string, InboxStateRow>>
  setState(ref: string, i: { status: InboxStatus; note: string | null; reason: string }, actorId: string): Promise<void>
  recordSend(
    i: {
      audienceKind: NotificationSendRecord['audienceKind']
      audienceDetail: string | null
      body: string
      recipientCount: number
      deliveredCount: number
      status: NotificationSendRecord['status']
      error: string | null
    },
    actorId: string,
  ): Promise<NotificationSendRecord>
  listSends(f: { limit: number; offset: number }): Promise<{ rows: NotificationSendRecord[]; total: number }>
  staffNames(ids: (string | null)[]): Promise<Map<string, string>>
}
export const INBOX_STORE = Symbol('INBOX_STORE')
