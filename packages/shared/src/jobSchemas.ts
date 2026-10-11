import { z } from 'zod'
import { CHANGE_ORDER_STATUSES, FREQUENCIES, JOB_STATUSES, type ChangeOrderStatus, type Frequency, type JobStatus, type JobWatch, type Match } from './jobs'
import type { PaymentStatus } from './requests'

const reason = z.string().trim().min(3, 'Give a reason of at least 3 characters').max(1000)

export const jobListQuerySchema = z.object({
  status: z.enum(JOB_STATUSES).optional(),
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0),
})
export type JobListQuery = z.infer<typeof jobListQuerySchema>

export const dispatchSchema = z.object({ xpertId: z.string().trim().min(1).max(80) })
export const replaceSchema = z.object({ xpertId: z.string().trim().min(1).max(80), reason })
export const cancelJobSchema = z.object({ reason })
export const confirmSchema = z.object({ side: z.enum(['employer', 'xpert']) })

export const changeOrderSchema = z.object({
  jobId: z.string().uuid(),
  description: z.string().trim().min(5, 'Describe the change').max(1000),
  amountDeltaGhs: z.number().min(-1_000_000).max(1_000_000).default(0),
})
export type ChangeOrderInput = z.infer<typeof changeOrderSchema>
export const rejectChangeOrderSchema = z.object({ side: z.enum(['employer', 'xpert']), note: z.string().trim().min(3).max(500) })
export const changeOrderListQuerySchema = z.object({ status: z.enum(CHANGE_ORDER_STATUSES).optional(), jobId: z.string().uuid().optional() })

export const recurringSchema = z.object({
  employerName: z.string().trim().min(2).max(120),
  employerPhone: z.string().trim().min(5).max(40),
  employerId: z.string().trim().max(80).optional(),
  category: z.string().trim().min(2).max(120),
  description: z.string().trim().min(5).max(2000),
  location: z.string().trim().min(2).max(300),
  timing: z.string().trim().min(2).max(300),
  frequency: z.enum(FREQUENCIES),
  nextDue: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date'),
})
export type RecurringInput = z.infer<typeof recurringSchema>
export const recurringPatchSchema = z.object({ active: z.boolean(), reason })

export type JobRecord = {
  id: string
  requestId: string
  paymentId: string
  recurringId: string | null
  category: string
  location: string
  timing: string
  amountGhs: number
  status: JobStatus
  xpertId: string | null
  xpertName: string | null
  employerName: string
  employerPhone: string
  dispatchedAt: string | null
  startedAt: string | null
  employerConfirmedAt: string | null
  xpertConfirmedAt: string | null
  completedAt: string | null
  cancelledReason: string | null
  createdAt: string
  coordinatorId: string | null
  watch: JobWatch | null
}
export type AssignmentRecord = { id: string; jobId: string; xpertId: string; xpertName: string | null; status: 'active' | 'replaced' | 'completed' | 'withdrawn'; assignedAt: string; endedAt: string | null; endReason: string | null; assignedByName: string | null }
export type ChangeOrderRecord = { id: string; jobId: string; jobLabel: string | null; description: string; amountDeltaGhs: number; status: ChangeOrderStatus; employerConfirmedAt: string | null; xpertConfirmedAt: string | null; rejectedBy: 'employer' | 'xpert' | null; note: string | null; createdAt: string; loggedByName: string | null }
export type RecurringRecord = { id: string; employerName: string; employerPhone: string; category: string; description: string; location: string; timing: string; frequency: Frequency; nextDue: string; active: boolean; lastGeneratedAt: string | null; due: boolean }
export type JobDetail = { job: JobRecord; assignments: AssignmentRecord[]; changeOrders: ChangeOrderRecord[]; paymentStatus: PaymentStatus | null; matches: Match[] }
export type JobCounts = { needsXpert: number; live: number; needsAttention: number; changeOrdersWaiting: number; recurringDue: number }
