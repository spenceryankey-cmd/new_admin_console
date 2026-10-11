import { z } from 'zod'
import { type Countdown, CALLBACK_OUTCOMES, EVIDENCE_OUTCOMES, EVIDENCE_TYPES, REFERENCE_OUTCOMES, VERIFICATION_SOURCES, type CallbackOutcome, type EvidenceOutcome, type EvidenceType, type ReferenceOutcome, type VerificationSource, type EvidenceChecklist } from './screening'
import { TRIGGERS, XPERT_STATUSES, type Move, type ScreeningConfig, type Trigger, type XpertStatus } from './xpertStatus'

const text = (max = 1000) => z.string().trim().max(max)
const reason = z.string().trim().min(3, 'Give a reason of at least 3 characters').max(1000)

export const transitionSchema = z.object({
  expectedFrom: z.enum(XPERT_STATUSES),
  to: z.enum(XPERT_STATUSES),
  trigger: z.enum(TRIGGERS),
  reason: text().optional(),
})
export type TransitionInput = z.infer<typeof transitionSchema>

export const callbackSchema = z.object({
  outcome: z.enum(CALLBACK_OUTCOMES),
  note: text().optional(),
})
export type CallbackInput = z.infer<typeof callbackSchema>

export const addEvidenceSchema = z
  .object({
    xpertId: z.string().trim().min(1),
    taskType: z.string().trim().min(2).max(120),
    evidenceType: z.enum(EVIDENCE_TYPES),
    link: z.string().trim().url('Enter a full link starting with https://').max(2000).optional(),
    filePath: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.link || v.filePath, { message: 'Add a link or upload a file' })
export type AddEvidenceInput = z.infer<typeof addEvidenceSchema>

export const reviewEvidenceSchema = z.object({
  outcome: z.enum(['pass', 'fail']),
  ticked: z.record(z.boolean()).default({}),
  autoFailHits: z.array(z.string()).default([]),
  reason: text().optional(),
})
export type ReviewEvidenceInput = z.infer<typeof reviewEvidenceSchema>

export const uploadUrlSchema = z.object({
  xpertId: z.string().trim().min(1),
  fileName: z.string().trim().min(1).max(200),
})

export const addReferenceSchema = z.object({
  xpertId: z.string().trim().min(1),
  name: z.string().trim().min(2).max(120),
  contact: z.string().trim().min(5).max(60),
  relationship: z.string().trim().min(2).max(120),
})
export type AddReferenceInput = z.infer<typeof addReferenceSchema>

export const logReferenceCallSchema = z.object({
  result: z.enum(['confirmed', 'inconclusive', 'not_reached']),
  note: text().optional(),
})
export type LogReferenceCallInput = z.infer<typeof logReferenceCallSchema>

export const approveSchema = z.object({
  verificationSource: z.enum(VERIFICATION_SOURCES),
  note: text().optional(),
})
export type ApproveInput = z.infer<typeof approveSchema>

export const addGuarantorSchema = z.object({
  name: z.string().trim().min(2).max(120),
  contact: z.string().trim().min(5).max(60),
  relationship: z.string().trim().max(120).optional(),
})
export type AddGuarantorInput = z.infer<typeof addGuarantorSchema>

export const retractGuarantorSchema = z.object({ reason })
export const claimSchema = z.object({ release: z.boolean().default(false) })

export const configValueSchema = z.object({
  value: z.unknown(),
  reason,
})

export const xpertListQuerySchema = z.object({
  status: z.enum(XPERT_STATUSES).optional(),
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0),
})
export type XpertListQuery = z.infer<typeof xpertListQuerySchema>

// Response shapes ---------------------------------------------------------

export type XpertSummary = {
  id: string
  fullName: string
  phone: string | null
  homeArea: string | null
  skills: string[]
  status: XpertStatus
  accountActive: boolean
  verificationSource: VerificationSource | null
  activatedAt: string | null
  createdAt: string | null
  /** When the current status began, from the history. */
  statusSince: string | null
}

export type GuarantorRecord = {
  id: string
  xpertId: string
  name: string
  contact: string
  relationship: string | null
  namedAt: string
  explainerMessageSentAt: string | null
  callbackConfirmedAt: string | null
  callbackOutcome: CallbackOutcome | null
  retractedAt: string | null
  assignedTo: string | null
  assignedToName: string | null
}

export type EvidenceRecord = {
  id: string
  xpertId: string
  taskType: string
  evidenceType: EvidenceType
  link: string | null
  filePath: string | null
  reviewOutcome: EvidenceOutcome
  reviewedBy: string | null
  reviewedByName: string | null
  reviewedAt: string | null
  autoFailHits: string[]
  assignedTo: string | null
  assignedToName: string | null
  createdAt: string
}

export type ReferenceRecord = {
  id: string
  xpertId: string
  name: string
  contact: string
  relationship: string
  outcome: ReferenceOutcome
  attemptsMade: number
  calledBy: string | null
  calledByName: string | null
  calledAt: string | null
  warnings: string[]
  assignedTo: string | null
  assignedToName: string | null
  createdAt: string
}

export type StatusHistoryRow = {
  id: number
  oldStatus: XpertStatus | null
  newStatus: XpertStatus
  changedBy: string | null
  changedByName: string | null
  automatic: boolean
  trigger: Trigger | null
  reason: string | null
  changedAt: string
}

export type XpertDetail = {
  xpert: XpertSummary
  guarantor: GuarantorRecord | null
  evidence: EvidenceRecord[]
  references: ReferenceRecord[]
  history: StatusHistoryRow[]
  moves: Move[]
  screeningComplete: boolean
  screeningGaps: string[]
}

export type QueueEntry<T> = {
  item: T
  xpert: Pick<XpertSummary, 'id' | 'fullName' | 'phone' | 'status' | 'verificationSource'>
  waitingSince: string
}

export type QueueCounts = {
  guarantors: number
  evidence: number
  references: number
  approvals: number
}

export type ConfigEntry = { key: string; value: unknown; pending: boolean; note: string | null; updatedAt: string }
export type ScreeningConfigResponse = { config: ScreeningConfig; pending: string[] }
export type ChecklistConfig = Record<string, EvidenceChecklist>

export type GuarantorQueueEntry = QueueEntry<GuarantorRecord> & { countdown: Countdown | null }

export type ApprovalQueueEntry = {
  xpert: QueueEntry<never>['xpert']
  waitingSince: string
  guarantor: GuarantorRecord | null
  evidence: { passed: number; failed: number; pending: number }
  gaps: string[]
  ready: boolean
  /** Two weeks in skill verification: a prompt to chase, never an automatic status change. */
  nudgeDue: boolean
}

export type QueueKind = 'guarantors' | 'evidence' | 'references'
