// Requests, quotes and payments. One place for the request status rules, so the API, the
// screens and the tests agree. The employer only ever accepts or declines a quote.

export const REQUEST_STATUSES = ['new', 'quoted', 'accepted', 'declined', 'expired', 'cancelled'] as const
export type RequestStatus = (typeof REQUEST_STATUSES)[number]

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  new: 'New',
  quoted: 'Quote sent',
  accepted: 'Accepted',
  declined: 'Declined',
  expired: 'Quote expired',
  cancelled: 'Cancelled',
}

export const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'declined', 'expired', 'withdrawn'] as const
export type QuoteStatus = (typeof QUOTE_STATUSES)[number]
export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  accepted: 'Accepted',
  declined: 'Declined',
  expired: 'Expired',
  withdrawn: 'Withdrawn',
}

export const PAYMENT_STATUSES = ['pending', 'received', 'released', 'refunded'] as const
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: 'Waiting for payment',
  received: 'Payment received',
  released: 'Released to the Xpert',
  refunded: 'Refunded',
}
export const PAYMENT_METHODS = ['momo'] as const

export const BENCHMARK_UNITS = ['per_job', 'per_hour', 'per_day'] as const
export type BenchmarkUnit = (typeof BENCHMARK_UNITS)[number]
export const BENCHMARK_UNIT_LABELS: Record<BenchmarkUnit, string> = { per_job: 'Per job', per_hour: 'Per hour', per_day: 'Per day' }

type Move = { from: RequestStatus; to: RequestStatus; reasonRequired: boolean; note: string }

/** Every legal request move. Anything not listed is refused. */
export const REQUEST_MOVES: readonly Move[] = [
  { from: 'new', to: 'quoted', reasonRequired: false, note: 'A quote is sent.' },
  { from: 'quoted', to: 'new', reasonRequired: true, note: 'The quote is withdrawn so a new one can be prepared.' },
  { from: 'quoted', to: 'accepted', reasonRequired: false, note: 'The employer accepts the quote.' },
  { from: 'quoted', to: 'declined', reasonRequired: false, note: 'The employer declines the quote.' },
  { from: 'quoted', to: 'expired', reasonRequired: false, note: 'The quote validity ran out.' },
  { from: 'new', to: 'cancelled', reasonRequired: true, note: 'The request is cancelled.' },
  { from: 'quoted', to: 'cancelled', reasonRequired: true, note: 'The request is cancelled.' },
]

export const REQUEST_TERMINAL: readonly RequestStatus[] = ['declined', 'expired', 'cancelled']

export function requestMove(from: RequestStatus, to: RequestStatus): Move | null {
  return REQUEST_MOVES.find((m) => m.from === from && m.to === to) ?? null
}

export type QuoteLine = { description: string; amountGhs: number }

const pesewas = (n: number) => Math.round(n * 100)

/** Problems with a quote's amounts. Empty means it can be sent. */
export function quoteProblems(lines: readonly QuoteLine[], totalGhs: number): string[] {
  const out: string[] = []
  if (lines.length === 0) out.push('Add at least one line.')
  if (lines.some((l) => !(l.amountGhs > 0))) out.push('Every line needs an amount above zero.')
  if (!(totalGhs > 0)) out.push('The total must be above zero.')
  const sum = lines.reduce((s, l) => s + pesewas(l.amountGhs), 0)
  if (lines.length > 0 && sum !== pesewas(totalGhs)) out.push('The lines do not add up to the total.')
  return out
}

export const DEFAULT_QUOTE_VALIDITY_DAYS = 3

export function quoteValidUntil(sentAt: Date, days: number): Date {
  return new Date(sentAt.getTime() + days * 86_400_000)
}

export const quoteIsExpired = (validUntilIso: string | null | undefined, now: Date) => !!validUntilIso && now.getTime() >= new Date(validUntilIso).getTime()

export const formatGhs = (n: number) => `GHS ${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
