import { z } from 'zod'
import { FEEDBACK_REASONS, FLAG_CATEGORIES, FLAG_RAISERS, FLAG_STATUSES, LOW_RATING_MAX, type FeedbackReason, type FlagCategory, type FlagRaiser, type FlagStatus, type ReliabilityRecord } from './trust'

const note = z.string().trim().min(3, 'Write at least 3 characters').max(1000)

export const raiseFlagSchema = z.object({
  xpertId: z.string().trim().min(1).max(80),
  jobId: z.string().uuid().optional(),
  raisedBy: z.enum(FLAG_RAISERS).default('staff'),
  category: z.enum(FLAG_CATEGORIES),
  detail: z.string().trim().min(5, 'Say what happened').max(2000),
})
export type RaiseFlagInput = z.infer<typeof raiseFlagSchema>

export const counterFlagSchema = z.object({
  raisedBy: z.enum(['employer', 'xpert']),
  detail: z.string().trim().min(5, 'Say what they said').max(2000),
})
export type CounterFlagInput = z.infer<typeof counterFlagSchema>

export const decideFlagSchema = z.object({
  outcome: z.enum(['upheld', 'dismissed']),
  note,
  /** Only with an upheld flag. Sends the Xpert to Under Review in the same step. */
  sendToReview: z.boolean().default(false),
})
export type DecideFlagInput = z.infer<typeof decideFlagSchema>

export const flagListQuerySchema = z.object({
  status: z.enum(FLAG_STATUSES).optional(),
  xpertId: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0),
})
export type FlagListQuery = z.infer<typeof flagListQuerySchema>

export const feedbackSchema = z
  .object({
  jobId: z.string().uuid(),
  side: z.enum(['employer', 'xpert']),
  rating: z.number().int().min(1).max(5),
  onTime: z.boolean().nullable().default(null),
  wouldRepeat: z.boolean().nullable().default(null),
  reasons: z.array(z.enum(FEEDBACK_REASONS)).max(FEEDBACK_REASONS.length).default([]),
  taskTypeCode: z.string().trim().max(120).nullable().default(null),
  comment: z.string().trim().max(1000).optional(),
})
  .superRefine((v, ctx) => {
    if (new Set(v.reasons).size !== v.reasons.length) ctx.addIssue({ code: 'custom', path: ['reasons'], message: 'Each reason can be chosen once.' })
    if (v.rating <= LOW_RATING_MAX && v.reasons.length === 0) ctx.addIssue({ code: 'custom', path: ['reasons'], message: 'A rating of 2 or lower needs at least one reason.' })
  })
export type FeedbackInput = z.infer<typeof feedbackSchema>

export const coordinatorSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(40).optional(),
  area: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
})
export type CoordinatorInput = z.infer<typeof coordinatorSchema>
export const assignXpertSchema = z.object({ xpertId: z.string().trim().min(1).max(80), reason: note })
export const coordinatorActiveSchema = z.object({ active: z.boolean(), reason: note })

export type FlagRecord = {
  id: string
  xpertId: string
  xpertName: string | null
  jobId: string | null
  kind: 'flag' | 'counter_flag'
  parentFlagId: string | null
  raisedBy: FlagRaiser
  raisedByStaffName: string | null
  category: FlagCategory
  detail: string
  status: FlagStatus
  decidedByName: string | null
  decidedAt: string | null
  decisionNote: string | null
  createdAt: string
}
export type FlagDetail = { flag: FlagRecord; counters: FlagRecord[]; reliability: ReliabilityRecord }

export type FeedbackRecord = {
  id: string
  jobId: string
  jobLabel: string | null
  xpertId: string | null
  xpertName: string | null
  side: 'employer' | 'xpert'
  rating: number
  onTime: boolean | null
  wouldRepeat: boolean | null
  comment: string | null
  reasons: FeedbackReason[]
  taskTypeCode: string | null
  taskTypeLabel: string | null
  createdAt: string
  loggedByName: string | null
}

export type CoordinatorRecord = { id: string; fullName: string; phone: string | null; area: string | null; active: boolean; note: string | null; createdAt: string }
export type CoordinatorMetrics = {
  xperts: number
  activeXperts: number
  byStatus: Record<string, number>
  jobsCompleted: number
  cleanJobs: number
  avgRating: number | null
  flagsUpheld: number
  jobsLive: number
}
export type CoordinatorXpert = { xpertId: string; fullName: string | null; status: string | null; verificationSource: string | null; reliability: ReliabilityRecord }
export type CoordinatorDetail = { coordinator: CoordinatorRecord; metrics: CoordinatorMetrics; roster: CoordinatorXpert[] }
export type CoordinatorSummary = CoordinatorRecord & { metrics: CoordinatorMetrics }
export type TrustCounts = { flagsOpen: number; feedbackThisWeek: number }
