import { z } from 'zod'
import {
  BENCHMARK_UNITS,
  PAYMENT_METHODS,
  REQUEST_STATUSES,
  type BenchmarkUnit,
  type PaymentStatus,
  type QuoteLine,
  type QuoteStatus,
  type RequestStatus,
} from './requests'

const text = (max = 2000) => z.string().trim().max(max)
const reason = z.string().trim().min(3, 'Give a reason of at least 3 characters').max(1000)
const money = z.number().positive('Enter an amount above zero').max(10_000_000).refine((n) => Math.round(n * 100) === Math.round(n * 100), 'Use at most two decimal places')

export const createRequestSchema = z.object({
  employerName: z.string().trim().min(2).max(120),
  employerPhone: z.string().trim().min(5).max(40),
  employerId: z.string().trim().max(80).optional(),
  category: z.string().trim().min(2).max(120),
  description: text().min(5, 'Describe the work'),
  location: z.string().trim().min(2).max(300),
  timing: z.string().trim().min(2).max(300),
  specialRequirements: text().optional(),
  photos: z.array(z.string().url()).max(10).default([]),
})
export type CreateRequestInput = z.infer<typeof createRequestSchema>

export const requestListQuerySchema = z.object({
  status: z.enum(REQUEST_STATUSES).optional(),
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0),
})
export type RequestListQuery = z.infer<typeof requestListQuerySchema>

export const cancelRequestSchema = z.object({ reason })

export const quoteLineSchema = z.object({ description: z.string().trim().min(2).max(200), amountGhs: money })
export const composeQuoteSchema = z.object({
  lines: z.array(quoteLineSchema).min(1).max(30),
  totalGhs: money,
  notes: text(1000).optional(),
})
export type ComposeQuoteInput = z.infer<typeof composeQuoteSchema>

export const quoteResponseSchema = z.object({ response: z.enum(['accepted', 'declined']), note: text(500).optional() })
export type QuoteResponseInput = z.infer<typeof quoteResponseSchema>

export const withdrawQuoteSchema = z.object({ reason })

export const paymentReceivedSchema = z.object({
  momoReference: z.string().trim().min(4, 'Enter the MoMo reference').max(60),
  method: z.enum(PAYMENT_METHODS).default('momo'),
})
export type PaymentReceivedInput = z.infer<typeof paymentReceivedSchema>

export const benchmarkSchema = z.object({
  category: z.string().trim().min(2).max(120),
  unit: z.enum(BENCHMARK_UNITS),
  amountGhs: money,
  reason,
})
export type BenchmarkInput = z.infer<typeof benchmarkSchema>

export const benchmarkUpdateSchema = z.object({ amountGhs: money.optional(), active: z.boolean().optional(), reason }).refine((v) => v.amountGhs !== undefined || v.active !== undefined, { message: 'Nothing to change' })

export const bandSchema = z
  .object({
    xpertId: z.string().trim().min(1).max(80),
    category: z.string().trim().min(2).max(120),
    minGhs: money,
    maxGhs: money,
    reason,
  })
  .refine((v) => v.maxGhs >= v.minGhs, { message: 'The top of the band cannot be below the bottom', path: ['maxGhs'] })
export type BandInput = z.infer<typeof bandSchema>
export const bandUpdateSchema = z.object({ minGhs: money.optional(), maxGhs: money.optional(), active: z.boolean().optional(), reason })

// Response shapes ------------------------------------------------------------------
export type RequestSummary = {
  id: string
  employerName: string
  employerPhone: string
  category: string
  location: string
  timing: string
  status: RequestStatus
  createdAt: string
  /** Total of the live quote, when there is one. */
  quotedGhs: number | null
}

export type QuoteRecord = {
  id: string
  requestId: string
  version: number
  status: QuoteStatus
  totalGhs: number
  lines: QuoteLine[]
  notes: string | null
  composedBy: string | null
  composedByName: string | null
  sentAt: string | null
  validUntil: string | null
  respondedAt: string | null
  responseSource: 'employer' | 'staff_logged' | null
  responseNote: string | null
  createdAt: string
}

export type PaymentRecord = {
  id: string
  requestId: string
  quoteId: string
  amountGhs: number
  method: 'momo'
  status: PaymentStatus
  momoReference: string | null
  receivedAt: string | null
  recordedByName: string | null
}

export type RequestRecord = RequestSummary & {
  employerId: string | null
  description: string
  specialRequirements: string | null
  photos: string[]
  sourceTaskId: string | null
}

export type RequestDetail = {
  request: RequestRecord
  quotes: QuoteRecord[]
  payment: PaymentRecord | null
  benchmarks: BenchmarkRate[]
  validityDays: number
  canSend: boolean
}

export type BenchmarkRate = { id: string; category: string; unit: BenchmarkUnit; amountGhs: number; active: boolean; updatedAt: string }
export type PriceBand = { id: string; xpertId: string; xpertName: string | null; category: string; minGhs: number; maxGhs: number; active: boolean; updatedAt: string }
export type RequestCounts = { newRequests: number; awaitingResponse: number; awaitingPayment: number }
