import { describe, expect, it } from 'vitest'
import {
  ACTIVE_STATUSES,
  DEFAULT_SCREENING_CONFIG,
  EDGES,
  PENDING_CONFIG_KEYS,
  TERMINAL_STATUSES,
  XPERT_STATUSES,
  accessEffect,
  allowedMoves,
  evaluateTransition,
  guarantorDeadlinePassed,
  type Actor,
  type TransitionContext,
  type XpertStatus,
} from './index'

const NOW = new Date('2026-10-20T12:00:00Z')
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString()

const system: Actor = { kind: 'system' }
const staff = (userId: string, ...permissions: string[]): Actor => ({ kind: 'staff', userId, permissions: permissions as never })
const ops = staff('ops1', 'guarantors.review', 'xperts.status.voluntary')
const decider = staff('dm1', 'xperts.approve', 'xperts.status.decide')

const ctx = (over: Partial<TransitionContext> = {}): TransitionContext => ({
  actor: system, now: NOW, config: DEFAULT_SCREENING_CONFIG, ...over,
})

const goodGuarantor = { namedAt: ago(3), explainerSentAt: ago(2), callbackOutcome: 'yes' as const }

describe('state machine shape', () => {
  it('rejects every move that is not in the table', () => {
    const legal = new Set(EDGES.map((e) => `${e.from}>${e.to}`))
    for (const from of XPERT_STATUSES) {
      for (const to of XPERT_STATUSES) {
        if (legal.has(`${from}>${to}`)) continue
        const r = evaluateTransition(from, to, ctx({ actor: staff('x', 'xperts.approve', 'xperts.status.decide', 'guarantors.review'), reason: 'testing', trigger: 'review_outcome' }))
        expect(r.ok, `${from} to ${to} should be illegal`).toBe(false)
        if (!r.ok) expect(r.code).toBe('illegal_transition')
      }
    }
  })

  it('has no way out of the terminal statuses', () => {
    for (const t of TERMINAL_STATUSES) expect(EDGES.filter((e) => e.from === t)).toHaveLength(0)
  })

  it('never lets an Xpert skip screening straight to active', () => {
    for (const from of ['applied', 'guarantor_pending', 'guarantor_confirmed'] as XpertStatus[]) {
      for (const to of ACTIVE_STATUSES) expect(EDGES.some((e) => e.from === from && e.to === to)).toBe(false)
    }
  })
})

describe('rule 1: applied to guarantor pending', () => {
  it('is automatic once a guarantor is named', () => {
    const r = evaluateTransition('applied', 'guarantor_pending', ctx({ trigger: 'guarantor_named', guarantor: { namedAt: ago(0), explainerSentAt: null, callbackOutcome: null } }))
    expect(r).toMatchObject({ ok: true, automatic: true })
  })
  it('does not happen without a named guarantor', () => {
    expect(evaluateTransition('applied', 'guarantor_pending', ctx({ trigger: 'guarantor_named', guarantor: null })).ok).toBe(false)
  })
})

describe('rule 2: guarantor confirmation', () => {
  const move = (g: Parameters<typeof ctx>[0]['guarantor']) =>
    evaluateTransition('guarantor_pending', 'guarantor_confirmed', ctx({ actor: ops, trigger: 'guarantor_confirmed', guarantor: g }))

  it('needs both the explainer and a recorded yes', () => {
    expect(move(goodGuarantor).ok).toBe(true)
    expect(move({ ...goodGuarantor, explainerSentAt: null }).ok).toBe(false)
    expect(move({ ...goodGuarantor, callbackOutcome: null }).ok).toBe(false)
  })
  it('treats no and no response as not confirmed', () => {
    expect(move({ ...goodGuarantor, callbackOutcome: 'no' }).ok).toBe(false)
    expect(move({ ...goodGuarantor, callbackOutcome: 'no_response' }).ok).toBe(false)
  })
  it('cannot be done by the system alone', () => {
    const r = evaluateTransition('guarantor_pending', 'guarantor_confirmed', ctx({ trigger: 'guarantor_confirmed', guarantor: goodGuarantor }))
    expect(r).toMatchObject({ ok: false, code: 'needs_a_person' })
  })
  it('needs the guarantor queue permission', () => {
    const r = evaluateTransition('guarantor_pending', 'guarantor_confirmed', ctx({ actor: staff('x', 'quotes.read'), trigger: 'guarantor_confirmed', guarantor: goodGuarantor }))
    expect(r).toMatchObject({ ok: false, code: 'forbidden' })
  })
})

describe('guarantor refusal and the two week deadline', () => {
  it('an explicit no closes the application, with a reason', () => {
    const g = { namedAt: ago(2), explainerSentAt: ago(1), callbackOutcome: 'no' as const }
    expect(evaluateTransition('guarantor_pending', 'blocked_closed', ctx({ actor: ops, trigger: 'guarantor_declined', guarantor: g, reason: 'Guarantor declined by phone' })).ok).toBe(true)
    expect(evaluateTransition('guarantor_pending', 'blocked_closed', ctx({ actor: ops, trigger: 'guarantor_declined', guarantor: g })))
      .toMatchObject({ ok: false, code: 'reason_required' })
  })
  it('cannot be closed as declined when the guarantor has not said no', () => {
    expect(evaluateTransition('guarantor_pending', 'blocked_closed', ctx({ actor: ops, trigger: 'guarantor_declined', guarantor: goodGuarantor, reason: 'oops' })).ok).toBe(false)
  })
  it('the system closes it after two weeks without a valid confirmation', () => {
    const g = { namedAt: ago(14), explainerSentAt: ago(13), callbackOutcome: 'no_response' as const }
    expect(guarantorDeadlinePassed(g, NOW, 14)).toBe(true)
    expect(evaluateTransition('guarantor_pending', 'blocked_closed', ctx({ trigger: 'guarantor_deadline_passed', guarantor: g })).ok).toBe(true)
  })
  it('does not close early, and never closes a confirmed guarantor', () => {
    const early = { namedAt: ago(13), explainerSentAt: null, callbackOutcome: null }
    expect(evaluateTransition('guarantor_pending', 'blocked_closed', ctx({ trigger: 'guarantor_deadline_passed', guarantor: early })).ok).toBe(false)
    const confirmedLate = { namedAt: ago(20), explainerSentAt: ago(19), callbackOutcome: 'yes' as const }
    expect(guarantorDeadlinePassed(confirmedLate, NOW, 14)).toBe(false)
  })
})

describe('rule 3: guarantor confirmed to skill verification', () => {
  it('is automatic', () => {
    expect(evaluateTransition('guarantor_confirmed', 'skill_verification', ctx({ trigger: 'screening_started' }))).toMatchObject({ ok: true, automatic: true })
  })
  it('never moves status by itself when stuck, because the nudge is not a transition', () => {
    expect(EDGES.some((e) => e.from === 'skill_verification' && e.to !== 'provisional_active')).toBe(false)
  })
})

describe('rule 4: skill verification to provisionally active', () => {
  const approve = (over: Partial<TransitionContext>) =>
    evaluateTransition('skill_verification', 'provisional_active', ctx({ actor: decider, trigger: 'admin_approved', guarantor: goodGuarantor, evidence: { passed: 1, failed: 0, pending: 0 }, ...over }))

  it('needs a confirmed guarantor, passed evidence and an admin approval', () => {
    expect(approve({})).toMatchObject({ ok: true, setAccountActive: true })
    expect(approve({ guarantor: { ...goodGuarantor, callbackOutcome: 'no' } }).ok).toBe(false)
    expect(approve({ evidence: { passed: 0, failed: 1, pending: 0 } }).ok).toBe(false)
    expect(approve({ evidence: { passed: 1, failed: 0, pending: 1 } }).ok).toBe(false)
  })
  it('is not available to the system or to someone without approval rights', () => {
    expect(approve({ actor: system })).toMatchObject({ ok: false, code: 'needs_a_person' })
    expect(approve({ actor: ops })).toMatchObject({ ok: false, code: 'forbidden' })
  })
  it('does not count a retracted guarantor', () => {
    expect(approve({ guarantor: { ...goodGuarantor, retractedAt: ago(1) } }).ok).toBe(false)
  })
})

describe('rule 5: provisionally active to fully active', () => {
  const promote = (over: Partial<TransitionContext>) => evaluateTransition('provisional_active', 'full_active', ctx({ trigger: 'reference_confirmed', ...over }))
  it('happens on a confirmed reference, a verified certification or clean jobs, whichever comes first', () => {
    expect(promote({ referenceConfirmed: true }).ok).toBe(true)
    expect(promote({ trigger: 'certification_verified', certificationVerified: true }).ok).toBe(true)
    expect(promote({ trigger: 'clean_jobs_completed', cleanCompletedJobs: 1 }).ok).toBe(true)
  })
  it('does not happen with none of them', () => {
    expect(promote({}).ok).toBe(false)
  })
  it('respects the pending number of clean jobs setting', () => {
    const two = { ...DEFAULT_SCREENING_CONFIG, cleanJobsForFullActive: 2 }
    expect(promote({ trigger: 'clean_jobs_completed', cleanCompletedJobs: 1, config: two }).ok).toBe(false)
    expect(promote({ trigger: 'clean_jobs_completed', cleanCompletedJobs: 2, config: two }).ok).toBe(true)
  })
  it('does not switch access back on for an Xpert whose access was revoked', () => {
    expect(promote({ referenceConfirmed: true })).toMatchObject({ ok: true, setAccountActive: null })
  })
})

describe('rule 6: active to under review', () => {
  it.each(['flag_named_incident', 'no_shows', 'guarantor_retracted', 'conflicting_accounts', 'safety_concern'] as const)('allows %s', (trigger) => {
    for (const from of ACTIVE_STATUSES) {
      expect(evaluateTransition(from, 'under_review', ctx({ actor: decider, trigger, reason: 'Named incident on 10 Oct' })).ok).toBe(true)
    }
  })
  it('does not accept a low rating or any other reason', () => {
    expect(evaluateTransition('full_active', 'under_review', ctx({ actor: decider, trigger: 'review_outcome', reason: 'Low rating' }))).toMatchObject({ ok: false, code: 'trigger_not_allowed' })
  })
  it('requires a reason when a person does it', () => {
    expect(evaluateTransition('full_active', 'under_review', ctx({ actor: decider, trigger: 'safety_concern' }))).toMatchObject({ ok: false, code: 'reason_required' })
  })
  it('lets the system do it automatically for two no shows', () => {
    expect(evaluateTransition('full_active', 'under_review', ctx({ trigger: 'no_shows' }))).toMatchObject({ ok: true, automatic: true })
  })
  it('lets the guarantor team log a retraction even without status decision rights', () => {
    expect(evaluateTransition('full_active', 'under_review', ctx({ actor: ops, trigger: 'guarantor_retracted', reason: 'Guarantor called to withdraw' })).ok).toBe(true)
    expect(evaluateTransition('full_active', 'under_review', ctx({ actor: ops, trigger: 'safety_concern', reason: 'Seen on site' }))).toMatchObject({ ok: false, code: 'forbidden' })
  })
})

describe('rule 7: resolving a review or suspension', () => {
  const resolve = (from: XpertStatus, to: XpertStatus, over: Partial<TransitionContext> = {}) =>
    evaluateTransition(from, to, ctx({ actor: decider, trigger: from === 'suspended' ? 'suspension_outcome' : 'review_outcome', reason: 'Reviewed with both parties', previousActiveStatus: 'full_active', ...over }))

  it('under review resolves to active, suspended or removed', () => {
    expect(resolve('under_review', 'full_active').ok).toBe(true)
    expect(resolve('under_review', 'suspended').ok).toBe(true)
    expect(resolve('under_review', 'removed').ok).toBe(true)
  })
  it('suspended resolves to active or removed only', () => {
    expect(resolve('suspended', 'full_active').ok).toBe(true)
    expect(resolve('suspended', 'removed').ok).toBe(true)
    expect(resolve('suspended', 'under_review')).toMatchObject({ ok: false, code: 'illegal_transition' })
  })
  it('returns an Xpert to the level they held before', () => {
    expect(resolve('under_review', 'provisional_active', { previousActiveStatus: 'full_active' }).ok).toBe(false)
  })
  it('needs a reason for every move into or out of the sensitive statuses', () => {
    expect(resolve('under_review', 'suspended', { reason: '' })).toMatchObject({ ok: false, code: 'reason_required' })
    expect(resolve('suspended', 'full_active', { reason: ' ' })).toMatchObject({ ok: false, code: 'reason_required' })
  })
  it('requires someone other than the first pass reviewer to remove', () => {
    expect(resolve('under_review', 'removed', { firstPassReviewerIds: ['dm1'] })).toMatchObject({ ok: false, code: 'same_reviewer' })
    expect(resolve('under_review', 'removed', { firstPassReviewerIds: ['ops1'] }).ok).toBe(true)
  })
  it('switches site access off for suspended and removed Xperts', () => {
    expect(resolve('under_review', 'suspended')).toMatchObject({ setAccountActive: false })
    expect(resolve('under_review', 'removed')).toMatchObject({ setAccountActive: false })
  })
  it('restores access when someone is cleared', () => {
    expect(resolve('suspended', 'full_active')).toMatchObject({ setAccountActive: true })
  })
  it('only decision makers may do it', () => {
    expect(resolve('under_review', 'suspended', { actor: ops })).toMatchObject({ ok: false, code: 'forbidden' })
  })
})

describe('rule 8: inactive and active are voluntary', () => {
  const toInactive = (over: Partial<TransitionContext> = {}) => evaluateTransition('full_active', 'inactive', ctx({ actor: ops, trigger: 'voluntary_inactive', ...over }))
  const back = (over: Partial<TransitionContext> = {}) => evaluateTransition('inactive', 'full_active', ctx({ actor: ops, trigger: 'voluntary_return', previousActiveStatus: 'full_active', inactiveSince: ago(30), ...over }))

  it('works in both directions', () => {
    expect(toInactive().ok).toBe(true)
    expect(back().ok).toBe(true)
  })
  it('does not force reverification while the gap rule is undecided', () => {
    expect(DEFAULT_SCREENING_CONFIG.reverificationGapDays).toBeNull()
    expect(PENDING_CONFIG_KEYS.reverificationGapDays.pending).toBe(true)
    expect(back({ inactiveSince: ago(900) }).ok).toBe(true)
  })
  it('forces reverification after the configured gap', () => {
    const cfg = { ...DEFAULT_SCREENING_CONFIG, reverificationGapDays: 180 }
    expect(back({ config: cfg, inactiveSince: ago(200) })).toMatchObject({ ok: false, code: 'conditions_not_met' })
    const reverify = evaluateTransition('inactive', 'skill_verification', ctx({ actor: ops, trigger: 'voluntary_return', config: cfg, inactiveSince: ago(200) }))
    expect(reverify.ok).toBe(true)
    expect(back({ config: cfg, inactiveSince: ago(100) }).ok).toBe(true)
  })
  it('does not offer reverification when the gap is within the limit', () => {
    const cfg = { ...DEFAULT_SCREENING_CONFIG, reverificationGapDays: 180 }
    expect(evaluateTransition('inactive', 'skill_verification', ctx({ actor: ops, trigger: 'voluntary_return', config: cfg, inactiveSince: ago(10) })).ok).toBe(false)
  })
})

describe('access effects', () => {
  it('switches access on only when leaving screening or recovering', () => {
    expect(accessEffect('skill_verification', 'provisional_active', DEFAULT_SCREENING_CONFIG)).toBe(true)
    expect(accessEffect('suspended', 'full_active', DEFAULT_SCREENING_CONFIG)).toBe(true)
    expect(accessEffect('provisional_active', 'full_active', DEFAULT_SCREENING_CONFIG)).toBeNull()
  })
  it('leaves access alone under review unless configured otherwise', () => {
    expect(accessEffect('full_active', 'under_review', DEFAULT_SCREENING_CONFIG)).toBeNull()
    expect(accessEffect('full_active', 'under_review', { ...DEFAULT_SCREENING_CONFIG, underReviewKeepsAccess: false })).toBe(false)
  })
})

describe('allowedMoves for the buttons', () => {
  it('lists moves with a reason when one is blocked', () => {
    const moves = allowedMoves('guarantor_pending', { actor: ops, now: NOW, config: DEFAULT_SCREENING_CONFIG, guarantor: { namedAt: ago(1), explainerSentAt: null, callbackOutcome: null } })
    const confirm = moves.find((m) => m.to === 'guarantor_confirmed')!
    expect(confirm.allowed).toBe(false)
    expect(confirm.blockedReason).toMatch(/explainer/i)
  })
  it('marks an available move as allowed', () => {
    const moves = allowedMoves('guarantor_pending', { actor: ops, now: NOW, config: DEFAULT_SCREENING_CONFIG, guarantor: goodGuarantor })
    expect(moves.find((m) => m.to === 'guarantor_confirmed')?.allowed).toBe(true)
  })
})
