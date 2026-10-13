import { z } from 'zod'
import { isCategoryLabel } from './catalogue'

// The support inbox and the notifications staff send. One place for the rules.

export const INBOX_STATUSES = ['open', 'handled'] as const
export type InboxStatus = (typeof INBOX_STATUSES)[number]
export const INBOX_STATUS_LABELS: Record<InboxStatus, string> = { open: 'Needs attention', handled: 'Handled' }

/** What a person can ask the inbox to show. */
export const INBOX_FILTERS = ['open', 'handled', 'all'] as const
export type InboxFilter = (typeof INBOX_FILTERS)[number]
export const INBOX_FILTER_LABELS: Record<InboxFilter, string> = { open: 'Needs attention', handled: 'Handled', all: 'All' }

/** The most recent messages the console reads from the main site in one go. A real queue is far smaller. */
export const INBOX_READ_LIMIT = 1000

const reason = z.string().trim().min(3, 'Give a reason of at least 3 characters').max(500)

export const inboxListQuerySchema = z.object({
  status: z.enum(INBOX_FILTERS).default('open'),
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0),
})
export type InboxListQuery = z.infer<typeof inboxListQuerySchema>

export const handleInboxSchema = z.object({
  status: z.enum(INBOX_STATUSES),
  note: z.string().trim().max(1000).optional(),
  reason,
})
export type HandleInboxInput = z.infer<typeof handleInboxSchema>

/** A message as the main site wrote it. The console never edits any of these fields. */
export type RawInboxMessage = {
  ref: string
  type: string
  name: string | null
  phone: string | null
  body: string
  createdAt: string
}

export type InboxMessage = RawInboxMessage & {
  status: InboxStatus
  note: string | null
  handledByName: string | null
  handledAt: string | null
}

export type InboxCounts = { open: number; handled: number; total: number }

// Notifications -----------------------------------------------------------------------------------

export const NOTIFICATION_AUDIENCES = ['xpert', 'employer', 'all_xperts', 'all_employers', 'xperts_in_category'] as const
export type NotificationAudienceKind = (typeof NOTIFICATION_AUDIENCES)[number]
export const NOTIFICATION_AUDIENCE_LABELS: Record<NotificationAudienceKind, string> = {
  xpert: 'One Xpert',
  employer: 'One employer',
  all_xperts: 'All Xperts',
  all_employers: 'All employers',
  xperts_in_category: 'Xperts in one category',
}

export const notificationAudienceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('xpert'), id: z.string().trim().min(1).max(80) }),
  z.object({ kind: z.literal('employer'), id: z.string().trim().min(1).max(80) }),
  z.object({ kind: z.literal('all_xperts') }),
  z.object({ kind: z.literal('all_employers') }),
  z.object({ kind: z.literal('xperts_in_category'), category: z.string().trim().refine(isCategoryLabel, 'Choose one of the listed categories') }),
])
export type NotificationAudience = z.infer<typeof notificationAudienceSchema>

export const NOTIFICATION_BODY_MIN = 3
export const NOTIFICATION_BODY_MAX = 500
const notificationBody = z.string().trim().min(NOTIFICATION_BODY_MIN, 'Write the message').max(NOTIFICATION_BODY_MAX, `Keep it to ${NOTIFICATION_BODY_MAX} characters or fewer`)

export const previewNotificationSchema = z.object({ audience: notificationAudienceSchema })
export type PreviewNotificationInput = z.infer<typeof previewNotificationSchema>

export const sendNotificationSchema = z.object({
  audience: notificationAudienceSchema,
  body: notificationBody,
  /** The number the person saw and confirmed. If the audience has changed since, nothing is sent. */
  confirmRecipients: z.number().int().min(1),
})
export type SendNotificationInput = z.infer<typeof sendNotificationSchema>

/** At most this many sends per person per hour. A group send reaches many people, so it is slowed down on purpose. */
export const NOTIFICATION_SENDS_PER_HOUR = 10

export type NotificationRecipient = { id: string; name: string | null }
export type NotificationPreview = { recipients: number; sample: string[] }

export const NOTIFICATION_SEND_STATUSES = ['sent', 'partial', 'failed'] as const
export type NotificationSendStatus = (typeof NOTIFICATION_SEND_STATUSES)[number]
export type NotificationSendRecord = {
  id: string
  audienceKind: NotificationAudienceKind
  audienceDetail: string | null
  body: string
  recipientCount: number
  deliveredCount: number
  status: NotificationSendStatus
  error: string | null
  sentByName: string | null
  createdAt: string
}

/** A short description of who a notification went to, for lists and the audit log. */
export function describeAudience(a: NotificationAudience): string {
  switch (a.kind) {
    case 'xpert': return `Xpert ${a.id}`
    case 'employer': return `Employer ${a.id}`
    case 'all_xperts': return 'All Xperts'
    case 'all_employers': return 'All employers'
    case 'xperts_in_category': return `Xperts in ${a.category}`
  }
}
