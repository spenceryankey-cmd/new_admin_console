// Rules for the screening queues: evidence verdicts, reference warnings and the
// guarantor countdown. Pure functions, shared by the API and the screens.

import { DEFAULT_SCREENING_CONFIG, daysBetween, type EvidenceFacts, type GuarantorFacts, type ScreeningConfig } from './xpertStatus'

export const EVIDENCE_TYPES = ['submitted_evidence', 'certification'] as const
export type EvidenceType = (typeof EVIDENCE_TYPES)[number]
export const EVIDENCE_OUTCOMES = ['pass', 'fail', 'pending'] as const
export type EvidenceOutcome = (typeof EVIDENCE_OUTCOMES)[number]
export const CALLBACK_OUTCOMES = ['yes', 'no', 'no_response'] as const
export type CallbackOutcome = (typeof CALLBACK_OUTCOMES)[number]
export const REFERENCE_OUTCOMES = ['confirmed', 'inconclusive', 'unreachable', 'pending'] as const
export type ReferenceOutcome = (typeof REFERENCE_OUTCOMES)[number]
export const VERIFICATION_SOURCES = ['direct_beyondx', 'coordinator'] as const
export type VerificationSource = (typeof VERIFICATION_SOURCES)[number]
export const VERIFICATION_SOURCE_LABELS: Record<VerificationSource, string> = {
  direct_beyondx: 'Verified directly by BeyondX',
  coordinator: 'Verified through a coordinator',
}

/** A checklist for one task type. Items are yes or no, never scored. */
export type EvidenceChecklist = {
  items: { id: string; label: string }[]
  /** Conditions that fail the evidence outright when present. Shown apart from the checklist. */
  autoFail: { id: string; label: string }[]
}

export type ChecklistMap = Record<string, EvidenceChecklist>

export type EvidenceVerdictInput = {
  checklist: EvidenceChecklist | undefined
  /** item id to ticked */
  ticked: Record<string, boolean>
  /** ids of automatic fail conditions the reviewer saw */
  autoFailHits: readonly string[]
}

/** Pass or fail only. Any automatic fail condition forces a fail. A pass needs every checklist item ticked. */
export function evidenceVerdict(input: EvidenceVerdictInput): { allowedOutcome: 'pass' | 'fail'; reasons: string[] } {
  const reasons: string[] = []
  const known = new Set(input.checklist?.autoFail.map((a) => a.id) ?? [])
  const hits = input.autoFailHits.filter((h) => known.has(h))
  if (hits.length > 0) reasons.push('An automatic fail condition applies.')
  const items = input.checklist?.items ?? []
  const missing = items.filter((i) => !input.ticked[i.id])
  if (missing.length > 0) reasons.push(`${missing.length} checklist item${missing.length === 1 ? '' : 's'} not ticked.`)
  if (!input.checklist) reasons.push('No checklist is set up for this task type.')
  return { allowedOutcome: reasons.length === 0 ? 'pass' : 'fail', reasons }
}

export function evidenceFacts(rows: readonly { review_outcome: EvidenceOutcome }[]): EvidenceFacts {
  return {
    passed: rows.filter((r) => r.review_outcome === 'pass').length,
    failed: rows.filter((r) => r.review_outcome === 'fail').length,
    pending: rows.filter((r) => r.review_outcome === 'pending').length,
  }
}

const FAMILY = /\b(mother|mom|mum|father|dad|parent|brother|sister|sibling|son|daughter|child|wife|husband|spouse|uncle|aunt|auntie|cousin|nephew|niece|grand\w*|in.?law|family|relative|step\w+)\b/i
const digits = (s: string) => s.replace(/\D/g, '').replace(/^233/, '0')
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

/** Warnings, not blocks: the reference must not be a family member or the guarantor. */
export function referenceWarnings(
  ref: { name: string; contact: string; relationship: string },
  guarantor: { name?: string | null; contact?: string | null } | null | undefined,
): string[] {
  const out: string[] = []
  if (FAMILY.test(ref.relationship)) out.push('The relationship suggests a family member. A reference cannot be family.')
  if (guarantor?.contact && digits(ref.contact).length >= 7 && digits(ref.contact) === digits(guarantor.contact)) {
    out.push('This phone number matches the guarantor. A reference cannot be the guarantor.')
  }
  if (guarantor?.name && norm(ref.name) === norm(guarantor.name)) {
    out.push('This name matches the guarantor. A reference cannot be the guarantor.')
  }
  return out
}

/** Next state of a reference after a call. Unreachable only after enough failed attempts. */
export function applyReferenceCall(
  current: { attempts: number; outcome: ReferenceOutcome },
  result: 'confirmed' | 'inconclusive' | 'not_reached',
  config: ScreeningConfig = DEFAULT_SCREENING_CONFIG,
): { attempts: number; outcome: ReferenceOutcome } {
  const attempts = current.attempts + 1
  if (result === 'confirmed') return { attempts, outcome: 'confirmed' }
  if (result === 'inconclusive') return { attempts, outcome: 'inconclusive' }
  return { attempts, outcome: attempts >= config.referenceUnreachableAttempts ? 'unreachable' : 'pending' }
}

export type Countdown = { daysLeft: number; overdue: boolean; deadline: string; label: string }

/** The two week guarantor clock. Counts from the day the guarantor was named. */
export function guarantorCountdown(g: Pick<GuarantorFacts, 'namedAt'> | null | undefined, now: Date, days = DEFAULT_SCREENING_CONFIG.guarantorDeadlineDays): Countdown | null {
  if (!g?.namedAt) return null
  const deadline = new Date(new Date(g.namedAt).getTime() + days * 86_400_000)
  const left = Math.ceil((deadline.getTime() - now.getTime()) / 86_400_000)
  const overdue = left <= 0 && now.getTime() >= deadline.getTime()
  const label = overdue ? 'Overdue' : left === 1 ? '1 day left' : `${left} days left`
  return { daysLeft: Math.max(0, left), overdue, deadline: deadline.toISOString(), label }
}

/** Plain wording for how long something has been waiting. */
export function waitingFor(sinceIso: string, now: Date): string {
  const d = Math.floor(daysBetween(sinceIso, now))
  if (d < 1) {
    const h = Math.max(0, Math.floor(daysBetween(sinceIso, now) * 24))
    return h < 1 ? 'less than an hour' : `${h} hour${h === 1 ? '' : 's'}`
  }
  return `${d} day${d === 1 ? '' : 's'}`
}

export function skillVerificationNudgeDue(enteredAtIso: string | null | undefined, now: Date, config: ScreeningConfig = DEFAULT_SCREENING_CONFIG): boolean {
  return !!enteredAtIso && daysBetween(enteredAtIso, now) >= config.skillVerificationNudgeDays
}

// Starter content for the checklists and the reference call script. These are
// generic placeholders so the queues work on day one. They are marked pending:
// BeyondX operations must replace them with the real checklists per task type.
export const STARTER_CHECKLIST: EvidenceChecklist = {
  items: [
    { id: 'shows_task', label: 'The evidence shows the task type being done' },
    { id: 'shows_xpert', label: 'It is clearly the Xpert doing it, or the certificate carries their name' },
    { id: 'recent', label: 'It is recent, or the certificate is still valid' },
    { id: 'quality', label: 'The result meets the basic standard for this task type' },
  ],
  autoFail: [
    { id: 'not_theirs', label: 'The evidence belongs to someone else' },
    { id: 'altered', label: 'The evidence has been altered or cannot be opened' },
  ],
}

export const STARTER_REFERENCE_SCRIPT: string[] = [
  'Introduce yourself as calling from BeyondX and ask if now is a good time.',
  'How do you know this person, and for how long?',
  'What work have they done for you, and when?',
  'How was their attendance and punctuality?',
  'How was the quality of their work and how did they treat others?',
  'Would you hire them again? Why or why not?',
  'Is there anything we should know before we place them with an employer?',
]
