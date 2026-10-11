// The Xpert status state machine. This is the ONLY place that says which moves are
// legal. The API calls evaluateTransition() before every status change, the web app
// calls allowedMoves() to decide which buttons to show, and the tests pin every rule.
// Nothing else in the codebase may compare statuses to decide whether a move is allowed.

import type { Permission } from './access'

export const XPERT_STATUSES = [
  'applied',
  'guarantor_pending',
  'guarantor_confirmed',
  'skill_verification',
  'provisional_active',
  'full_active',
  'under_review',
  'suspended',
  'inactive',
  'removed',
  'blocked_closed',
] as const
export type XpertStatus = (typeof XPERT_STATUSES)[number]

export const STATUS_LABELS: Record<XpertStatus, string> = {
  applied: 'Applied',
  guarantor_pending: 'Guarantor pending',
  guarantor_confirmed: 'Guarantor confirmed',
  skill_verification: 'Skill verification',
  provisional_active: 'Provisionally active',
  full_active: 'Fully active',
  under_review: 'Under review',
  suspended: 'Suspended',
  inactive: 'Inactive',
  removed: 'Removed',
  blocked_closed: 'Blocked and closed',
}

export const ACTIVE_STATUSES = ['provisional_active', 'full_active'] as const satisfies readonly XpertStatus[]
export type ActiveStatus = (typeof ACTIVE_STATUSES)[number]
export const TERMINAL_STATUSES = ['removed', 'blocked_closed'] as const satisfies readonly XpertStatus[]

export const isXpertStatus = (v: unknown): v is XpertStatus => typeof v === 'string' && (XPERT_STATUSES as readonly string[]).includes(v)
export const isActiveStatus = (s: XpertStatus): s is ActiveStatus => (ACTIVE_STATUSES as readonly string[]).includes(s)

/** Why a move happened. Stored on the status history row. */
export const TRIGGERS = [
  'guarantor_named',
  'guarantor_confirmed',
  'guarantor_declined',
  'guarantor_deadline_passed',
  'screening_started',
  'admin_approved',
  'reference_confirmed',
  'certification_verified',
  'clean_jobs_completed',
  'flag_named_incident',
  'no_shows',
  'guarantor_retracted',
  'conflicting_accounts',
  'safety_concern',
  'review_outcome',
  'suspension_outcome',
  'voluntary_inactive',
  'voluntary_return',
] as const
export type Trigger = (typeof TRIGGERS)[number]

/** Reasons a person may be sent to Under Review. */
export const REVIEW_TRIGGERS = [
  'flag_named_incident',
  'no_shows',
  'guarantor_retracted',
  'conflicting_accounts',
  'safety_concern',
] as const satisfies readonly Trigger[]

export const TRIGGER_LABELS: Record<Trigger, string> = {
  guarantor_named: 'A guarantor was named',
  guarantor_confirmed: 'Guarantor confirmed by phone',
  guarantor_declined: 'Guarantor said no',
  guarantor_deadline_passed: 'No valid guarantor confirmation within the deadline',
  screening_started: 'Guarantor confirmed, skill verification began',
  admin_approved: 'Approved by an admin',
  reference_confirmed: 'Reference confirmed',
  certification_verified: 'Certification verified',
  clean_jobs_completed: 'Completed jobs with clean employer feedback',
  flag_named_incident: 'A flag with a named incident',
  no_shows: 'Two no shows within six weeks',
  guarantor_retracted: 'Guarantor retracted',
  conflicting_accounts: 'Conflicting accounts',
  safety_concern: 'Safety concern',
  review_outcome: 'Review concluded',
  suspension_outcome: 'Suspension concluded',
  voluntary_inactive: 'Xpert chose to go inactive',
  voluntary_return: 'Xpert chose to return',
}

/** Values the owner has not decided yet. Marked pending everywhere they appear. */
export type ScreeningConfig = {
  guarantorDeadlineDays: number
  skillVerificationNudgeDays: number
  referenceUnreachableAttempts: number
  cleanJobsForFullActive: number
  /** null means the rule is undecided: nobody is forced to reverify yet. */
  reverificationGapDays: number | null
  underReviewKeepsAccess: boolean
}

export const DEFAULT_SCREENING_CONFIG: ScreeningConfig = {
  guarantorDeadlineDays: 14,
  skillVerificationNudgeDays: 14,
  referenceUnreachableAttempts: 3,
  cleanJobsForFullActive: 1,
  reverificationGapDays: null,
  underReviewKeepsAccess: true,
}

export const PENDING_CONFIG_KEYS: Record<keyof ScreeningConfig, { pending: boolean; note: string }> = {
  guarantorDeadlineDays: { pending: false, note: 'Decided: two weeks.' },
  skillVerificationNudgeDays: { pending: false, note: 'Decided: a nudge after two weeks, never an automatic status change.' },
  referenceUnreachableAttempts: { pending: true, note: 'Pending: the brief says two to three unreachable attempts. Set to 3 until decided.' },
  cleanJobsForFullActive: { pending: true, note: 'Pending: the brief says one to two completed jobs. Set to 1 until decided.' },
  reverificationGapDays: { pending: true, note: 'Pending: how long a gap before an Xpert must reverify, and what that covers.' },
  underReviewKeepsAccess: { pending: true, note: 'Pending: whether an Xpert under review can still take jobs. Set to yes until decided.' },
}

export type GuarantorFacts = {
  namedAt: string | null
  explainerSentAt: string | null
  callbackOutcome: 'yes' | 'no' | 'no_response' | null
  retractedAt?: string | null
}

export type EvidenceFacts = { passed: number; failed: number; pending: number }

export type Actor =
  | { kind: 'system' }
  | { kind: 'staff'; userId: string; permissions: ReadonlySet<Permission> | readonly Permission[]; isSuperAdmin?: boolean }

export type TransitionContext = {
  actor: Actor
  reason?: string
  trigger?: Trigger
  now: Date
  config: ScreeningConfig
  guarantor?: GuarantorFacts | null
  evidence?: EvidenceFacts
  referenceConfirmed?: boolean
  certificationVerified?: boolean
  cleanCompletedJobs?: number
  /** The active status the Xpert held before Under Review or Suspended. */
  previousActiveStatus?: ActiveStatus | null
  /** People who did first pass work on this Xpert: the same person may not remove them. */
  firstPassReviewerIds?: readonly string[]
  /** When the Xpert went inactive, to apply the reverification gap. */
  inactiveSince?: string | null
}

export type TransitionResult =
  | { ok: true; automatic: boolean; setAccountActive: boolean | null; trigger: Trigger | null; reasonRequired: boolean }
  | { ok: false; code: string; message: string }

type Edge = {
  from: XpertStatus
  to: XpertStatus
  /** The system may make this move on its own, without a person. */
  automatic: boolean
  /** Permission a person needs. Empty for automatic only moves. */
  permission?: Permission
  reasonRequired: boolean
  /** Triggers that make this move valid. Empty means any. */
  triggers?: readonly Trigger[]
  check?: (ctx: TransitionContext, from: XpertStatus) => string | null
}

const SENSITIVE: readonly XpertStatus[] = ['under_review', 'suspended', 'removed']

const guarantorConfirmed = (g: GuarantorFacts | null | undefined) =>
  !!g && !g.retractedAt && !!g.explainerSentAt && g.callbackOutcome === 'yes'

/** What still stands between an Xpert and approval. Empty means ready. */
export function approvalGaps(guarantor: GuarantorFacts | null | undefined, evidence: EvidenceFacts | undefined): string[] {
  const gaps: string[] = []
  if (!guarantorConfirmed(guarantor)) gaps.push('The guarantor has not been confirmed.')
  if (!evidence || evidence.passed < 1) gaps.push('No skill evidence has passed review.')
  if (evidence && evidence.pending > 0) gaps.push('Some skill evidence is still waiting for review.')
  return gaps
}

export function daysBetween(fromIso: string, to: Date): number {
  return (to.getTime() - new Date(fromIso).getTime()) / 86_400_000
}

export function guarantorDeadlinePassed(g: GuarantorFacts | null | undefined, now: Date, days: number): boolean {
  if (!g?.namedAt) return false
  if (g.callbackOutcome === 'yes' && g.explainerSentAt) return false
  return daysBetween(g.namedAt, now) >= days
}

export const EDGES: readonly Edge[] = [
  // 1. Applied to guarantor pending: automatic once a guarantor is named.
  {
    from: 'applied', to: 'guarantor_pending', automatic: true, reasonRequired: false, triggers: ['guarantor_named'],
    check: (c) => (c.guarantor?.namedAt ? null : 'A guarantor has not been named yet.'),
  },
  // 2. Guarantor pending to confirmed needs the explainer sent AND a recorded yes. Hesitation is a no.
  {
    from: 'guarantor_pending', to: 'guarantor_confirmed', automatic: false, permission: 'guarantors.review', reasonRequired: false,
    triggers: ['guarantor_confirmed'],
    check: (c) => {
      const g = c.guarantor
      if (!g?.explainerSentAt) return 'The explainer message has not been sent to the guarantor.'
      if (g.callbackOutcome !== 'yes') return 'A verbal yes from the guarantor has not been recorded.'
      return null
    },
  },
  // An explicit no, or no valid confirmation within the deadline, closes the application.
  {
    from: 'guarantor_pending', to: 'blocked_closed', automatic: true, permission: 'guarantors.review', reasonRequired: true,
    triggers: ['guarantor_declined', 'guarantor_deadline_passed'],
    check: (c) => {
      const g = c.guarantor
      if (c.trigger === 'guarantor_declined') return g?.callbackOutcome === 'no' ? null : 'The guarantor has not said no.'
      return guarantorDeadlinePassed(g, c.now, c.config.guarantorDeadlineDays)
        ? null
        : `The ${c.config.guarantorDeadlineDays} day deadline has not passed yet.`
    },
  },
  // 3. Guarantor confirmed to skill verification: automatic.
  { from: 'guarantor_confirmed', to: 'skill_verification', automatic: true, reasonRequired: false, triggers: ['screening_started'] },
  // 4. Skill verification to provisionally active: guarantor confirmed and evidence passed, then an admin approves.
  {
    from: 'skill_verification', to: 'provisional_active', automatic: false, permission: 'xperts.approve', reasonRequired: false,
    triggers: ['admin_approved'],
    check: (c) => approvalGaps(c.guarantor, c.evidence)[0] ?? null,
  },
  // 5. Provisionally active to fully active: reference, certification or clean jobs, whichever comes first.
  {
    from: 'provisional_active', to: 'full_active', automatic: true, reasonRequired: false,
    triggers: ['reference_confirmed', 'certification_verified', 'clean_jobs_completed'],
    check: (c) => {
      const jobsOk = (c.cleanCompletedJobs ?? 0) >= c.config.cleanJobsForFullActive
      if (c.referenceConfirmed || c.certificationVerified || jobsOk) return null
      return 'Needs a confirmed reference, a verified certification, or completed jobs with clean feedback.'
    },
  },
  // 6. Active to under review. Only for the named triggers.
  ...(['provisional_active', 'full_active'] as const).map(
    (from): Edge => ({
      from, to: 'under_review', automatic: true, permission: 'xperts.status.decide', reasonRequired: true, triggers: REVIEW_TRIGGERS,
    }),
  ),
  // 7. Under review resolves to active, suspended or removed. Suspended resolves to active or removed.
  { from: 'under_review', to: 'provisional_active', automatic: false, permission: 'xperts.status.decide', reasonRequired: true, triggers: ['review_outcome'], check: (c) => (c.previousActiveStatus === 'provisional_active' ? null : 'They were not provisionally active before the review.') },
  { from: 'under_review', to: 'full_active', automatic: false, permission: 'xperts.status.decide', reasonRequired: true, triggers: ['review_outcome'], check: (c) => (c.previousActiveStatus === 'full_active' ? null : 'They were not fully active before the review.') },
  { from: 'under_review', to: 'suspended', automatic: false, permission: 'xperts.status.decide', reasonRequired: true, triggers: ['review_outcome'] },
  { from: 'under_review', to: 'removed', automatic: false, permission: 'xperts.status.decide', reasonRequired: true, triggers: ['review_outcome'] },
  { from: 'suspended', to: 'provisional_active', automatic: false, permission: 'xperts.status.decide', reasonRequired: true, triggers: ['suspension_outcome'], check: (c) => (c.previousActiveStatus === 'provisional_active' ? null : 'They were not provisionally active before the suspension.') },
  { from: 'suspended', to: 'full_active', automatic: false, permission: 'xperts.status.decide', reasonRequired: true, triggers: ['suspension_outcome'], check: (c) => (c.previousActiveStatus === 'full_active' ? null : 'They were not fully active before the suspension.') },
  { from: 'suspended', to: 'removed', automatic: false, permission: 'xperts.status.decide', reasonRequired: true, triggers: ['suspension_outcome'] },
  // 8. Active and inactive is voluntary in both directions.
  ...(['provisional_active', 'full_active'] as const).map(
    (from): Edge => ({
      from, to: 'inactive', automatic: false, permission: 'xperts.status.voluntary', reasonRequired: false, triggers: ['voluntary_inactive'],
    }),
  ),
  { from: 'inactive', to: 'provisional_active', automatic: false, permission: 'xperts.status.voluntary', reasonRequired: false, triggers: ['voluntary_return'], check: (c) => returnCheck(c, 'provisional_active') },
  { from: 'inactive', to: 'full_active', automatic: false, permission: 'xperts.status.voluntary', reasonRequired: false, triggers: ['voluntary_return'], check: (c) => returnCheck(c, 'full_active') },
  // After a long gap the Xpert reverifies instead of returning straight to active. The gap is undecided, so
  // this edge only opens once reverificationGapDays is set.
  {
    from: 'inactive', to: 'skill_verification', automatic: false, permission: 'xperts.status.voluntary', reasonRequired: false, triggers: ['voluntary_return'],
    check: (c) => (gapExceeded(c) ? null : 'The gap since they went inactive is within the limit, so they can return directly.'),
  },
]

function gapExceeded(c: TransitionContext): boolean {
  const gap = c.config.reverificationGapDays
  if (gap === null || !c.inactiveSince) return false
  return daysBetween(c.inactiveSince, c.now) > gap
}

function returnCheck(c: TransitionContext, to: ActiveStatus): string | null {
  if (gapExceeded(c)) return 'They have been inactive longer than the limit and must reverify first.'
  if (c.previousActiveStatus && c.previousActiveStatus !== to) return `They were ${STATUS_LABELS[c.previousActiveStatus].toLowerCase()} before going inactive.`
  return null
}

function actorCan(actor: Actor, needed: Permission | undefined): boolean {
  if (!needed) return true
  if (actor.kind === 'system') return true
  if (actor.isSuperAdmin) return true
  const perms = actor.permissions instanceof Set ? actor.permissions : new Set(actor.permissions)
  return perms.has(needed)
}

/** Whether going to this status switches the Xpert's site access on, off, or leaves it alone. */
export function accessEffect(from: XpertStatus, to: XpertStatus, config: ScreeningConfig): boolean | null {
  if (to === 'provisional_active' || to === 'full_active') {
    // Moving between the two active levels never switches access back on, so a revoked Xpert stays revoked.
    return isActiveStatus(from) ? null : true
  }
  if (to === 'under_review') return config.underReviewKeepsAccess ? null : false
  if (to === 'suspended' || to === 'removed' || to === 'blocked_closed' || to === 'inactive') return false
  return null
}

export function evaluateTransition(from: XpertStatus, to: XpertStatus, ctx: TransitionContext): TransitionResult {
  const candidates = EDGES.filter((e) => e.from === from && e.to === to)
  if (candidates.length === 0) {
    return { ok: false, code: 'illegal_transition', message: `${STATUS_LABELS[from]} cannot move to ${STATUS_LABELS[to]}.` }
  }

  let firstFailure: TransitionResult | null = null
  for (const edge of candidates) {
    const fail = (code: string, message: string): TransitionResult => ({ ok: false, code, message })
    const result = (() => {
      if (ctx.actor.kind === 'system' && !edge.automatic) {
        return fail('needs_a_person', `${STATUS_LABELS[from]} to ${STATUS_LABELS[to]} needs a person to make the decision.`)
      }
      if (edge.triggers && edge.triggers.length > 0) {
        if (!ctx.trigger) return fail('trigger_required', 'Say why this move is happening.')
        if (!edge.triggers.includes(ctx.trigger)) {
          return fail('trigger_not_allowed', `${TRIGGER_LABELS[ctx.trigger]} is not a valid reason for this move.`)
        }
      }
      // A guarantor retracting can be logged by the guarantor queue team, who may not decide status.
      const retractLogged = to === 'under_review' && ctx.trigger === 'guarantor_retracted' && ctx.actor.kind === 'staff' && actorCan(ctx.actor, 'guarantors.review')
      if (!retractLogged && !actorCan(ctx.actor, edge.permission)) {
        return fail('forbidden', 'Your role does not allow this status change.')
      }
      const needReason = edge.reasonRequired || SENSITIVE.includes(from) || SENSITIVE.includes(to)
      if (needReason && ctx.actor.kind === 'staff' && (ctx.reason ?? '').trim().length < 3) {
        return fail('reason_required', 'A reason is required for this status change.')
      }
      if (to === 'removed' && ctx.actor.kind === 'staff' && ctx.firstPassReviewerIds?.includes(ctx.actor.userId)) {
        return fail('same_reviewer', 'Someone other than the first pass reviewer must remove an Xpert.')
      }
      const checkMessage = edge.check ? edge.check(ctx, from) : null
      if (checkMessage) return fail('conditions_not_met', checkMessage)
      return {
        ok: true as const,
        automatic: edge.automatic,
        setAccountActive: accessEffect(from, to, ctx.config),
        trigger: ctx.trigger ?? null,
        reasonRequired: needReason,
      }
    })()
    if (result.ok) return result
    firstFailure ??= result
  }
  return firstFailure as TransitionResult
}

export type Move = {
  to: XpertStatus
  allowed: boolean
  blockedReason: string | null
  automatic: boolean
  /** A person can make this move from a button. False for moves the system makes by itself. */
  manual: boolean
  /** The reasons that make this move valid. Several means the person must pick one. */
  triggers: Trigger[]
}

/** Every status this Xpert could move to from here, with the reason when a move is blocked. For the buttons. */
export function allowedMoves(from: XpertStatus, ctx: Omit<TransitionContext, 'trigger'>): Move[] {
  const targets = [...new Set(EDGES.filter((e) => e.from === from).map((e) => e.to))]
  return targets.map((to) => {
    const triggers = [...new Set(EDGES.filter((e) => e.from === from && e.to === to).flatMap((e) => e.triggers ?? []))]
    // Try each trigger the edge accepts, and report the move as allowed if any works.
    const attempts = (triggers.length ? triggers : [undefined]).map((t) =>
      evaluateTransition(from, to, { ...ctx, trigger: t, reason: ctx.reason ?? 'check' }),
    )
    const good = attempts.find((a) => a.ok)
    const bad = attempts.find((a) => !a.ok)
    return {
      to,
      allowed: !!good,
      blockedReason: good ? null : bad && !bad.ok ? bad.message : null,
      automatic: EDGES.some((e) => e.from === from && e.to === to && e.automatic),
      manual: EDGES.some((e) => e.from === from && e.to === to && !!e.permission),
      triggers,
    }
  })
}
