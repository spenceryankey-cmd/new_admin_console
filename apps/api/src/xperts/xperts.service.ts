import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import {
  allowedMoves,
  approvalGaps,
  evaluateTransition,
  evidenceFacts,
  type Actor,
  type ApproveInput,
  type QueueCounts,
  type TransitionInput,
  type Trigger,
  type XpertDetail,
  type XpertListQuery,
  type XpertStatus,
  type XpertSummary,
} from '@beyondx/shared'
import type { StaffContext } from '../auth/staff-context'
import { ConfigService } from './config.service'
import { firstPassReviewers, guarantorFacts, hasCountedReference, hasVerifiedCertification, previousActiveStatus } from './facts'
import { StoreError, XPERT_STORE, type XpertStore } from './xpert.store'

export const staffActor = (s: StaffContext): Actor => ({
  kind: 'staff',
  userId: s.userId,
  permissions: s.permissions,
  isSuperAdmin: s.role === 'super_admin',
})

@Injectable()
export class XpertsService {
  constructor(
    @Inject(XPERT_STORE) private readonly store: XpertStore,
    private readonly config: ConfigService,
  ) {}

  async list(q: XpertListQuery) {
    const { rows, total } = await this.store.listXperts({ status: q.status, q: q.q, limit: q.limit, offset: q.offset })
    return { xperts: rows, total }
  }

  async counts(): Promise<QueueCounts> {
    return this.store.counts()
  }

  async mustGet(id: string): Promise<XpertSummary> {
    const x = await this.store.getXpert(id)
    if (!x) throw new NotFoundException('That Xpert was not found.')
    return x
  }

  /** Everything the status rules need to judge a move for this Xpert. */
  private async gather(xpertId: string) {
    const [guarantor, evidence, references, history, cfg, clean] = await Promise.all([
      this.store.liveGuarantor(xpertId),
      this.store.evidenceFor(xpertId),
      this.store.referencesFor(xpertId),
      this.store.history(xpertId),
      this.config.screening(),
      this.store.cleanCompletedJobs(xpertId),
    ])
    return {
      guarantor,
      evidence,
      references,
      history,
      config: cfg.config,
      facts: {
        guarantor: guarantorFacts(guarantor),
        evidence: evidenceFacts(evidence.map((e) => ({ review_outcome: e.reviewOutcome }))),
        referenceConfirmed: hasCountedReference(references),
        certificationVerified: hasVerifiedCertification(evidence),
        cleanCompletedJobs: clean,
        previousActiveStatus: previousActiveStatus(history),
        firstPassReviewerIds: firstPassReviewers(guarantor, evidence, references),
      },
    }
  }

  async detail(id: string, actor: StaffContext): Promise<XpertDetail> {
    const xpert = await this.mustGet(id)
    const g = await this.gather(id)
    const now = new Date()
    const moves = allowedMoves(xpert.status, { actor: staffActor(actor), now, config: g.config, ...g.facts })
    const gaps = xpert.status === 'skill_verification' ? approvalGaps(g.facts.guarantor, g.facts.evidence) : []
    return {
      xpert: { ...xpert, statusSince: g.history[0]?.changedAt ?? null },
      guarantor: g.guarantor,
      evidence: g.evidence,
      references: g.references,
      history: g.history,
      moves,
      screeningComplete: xpert.status === 'skill_verification' && gaps.length === 0,
      screeningGaps: gaps,
    }
  }

  /** A person changes an Xpert's status. The rules in packages/shared decide; the database makes it atomic. */
  async transition(actor: StaffContext, id: string, input: TransitionInput, extra?: Pick<ApproveInput, 'verificationSource'>): Promise<XpertDetail> {
    const xpert = await this.mustGet(id)
    if (xpert.status !== input.expectedFrom) {
      throw new ConflictException(`This Xpert is now ${xpert.status.replace(/_/g, ' ')}. Reload the page and try again.`)
    }
    const g = await this.gather(id)
    const verdict = evaluateTransition(xpert.status, input.to, {
      actor: staffActor(actor),
      reason: input.reason,
      trigger: input.trigger,
      now: new Date(),
      config: g.config,
      ...g.facts,
    })
    if (!verdict.ok) {
      if (verdict.code === 'forbidden') throw new ForbiddenException(verdict.message)
      if (verdict.code === 'reason_required' || verdict.code === 'trigger_required') throw new BadRequestException(verdict.message)
      throw new UnprocessableEntityException(verdict.message)
    }
    await this.apply({
      xpertId: id,
      from: xpert.status,
      to: input.to,
      trigger: verdict.trigger,
      reason: input.reason?.trim() || null,
      actorId: actor.userId,
      automatic: false,
      setActive: verdict.setAccountActive,
      verificationSource: extra?.verificationSource ?? null,
    })
    return this.detail(id, actor)
  }

  async approve(actor: StaffContext, id: string, body: ApproveInput): Promise<XpertDetail> {
    return this.transition(
      actor,
      id,
      { expectedFrom: 'skill_verification', to: 'provisional_active', trigger: 'admin_approved', reason: body.note },
      { verificationSource: body.verificationSource },
    )
  }

  /**
   * The system makes a move that needs no person. Returns false when the rules say it
   * does not apply right now, which is normal and not an error. Used after events and by the sweep.
   */
  async system(id: string, to: XpertStatus, trigger: Trigger, reason: string): Promise<boolean> {
    const xpert = await this.store.getXpert(id)
    if (!xpert) return false
    const g = await this.gather(id)
    const verdict = evaluateTransition(xpert.status, to, { actor: { kind: 'system' }, trigger, reason, now: new Date(), config: g.config, ...g.facts })
    if (!verdict.ok) return false
    try {
      await this.apply({ xpertId: id, from: xpert.status, to, trigger, reason, actorId: null, automatic: true, setActive: verdict.setAccountActive, verificationSource: null })
      return true
    } catch (e) {
      // Someone else moved them first. That is fine for an automatic move.
      if (e instanceof ConflictException) return false
      throw e
    }
  }

  /** Checks the automatic follow on moves after a guarantor, evidence or reference event. */
  async afterScreeningEvent(id: string): Promise<void> {
    const xpert = await this.store.getXpert(id)
    if (!xpert) return
    if (xpert.status === 'applied') await this.system(id, 'guarantor_pending', 'guarantor_named', 'Guarantor named')
    else if (xpert.status === 'guarantor_confirmed') await this.system(id, 'skill_verification', 'screening_started', 'Guarantor confirmed')
    else if (xpert.status === 'provisional_active') {
      const g = await this.gather(id)
      if (g.facts.certificationVerified) await this.system(id, 'full_active', 'certification_verified', 'Certification verified')
      else if (g.facts.referenceConfirmed) await this.system(id, 'full_active', 'reference_confirmed', 'Reference confirmed')
      else if (g.facts.cleanCompletedJobs >= g.config.cleanJobsForFullActive) await this.system(id, 'full_active', 'clean_jobs_completed', `${g.facts.cleanCompletedJobs} completed job${g.facts.cleanCompletedJobs === 1 ? '' : 's'} with clean feedback`)
    }
  }

  private async apply(a: { xpertId: string; from: XpertStatus; to: XpertStatus; trigger: Trigger | null; reason: string | null; actorId: string | null; automatic: boolean; setActive: boolean | null; verificationSource: ApproveInput['verificationSource'] | null }) {
    try {
      await this.store.applyTransition({
        xpertId: a.xpertId,
        expectedFrom: a.from,
        to: a.to,
        trigger: a.trigger,
        reason: a.reason,
        actorId: a.actorId,
        automatic: a.automatic,
        setActive: a.setActive,
        verificationSource: a.verificationSource,
      })
    } catch (e) {
      if (e instanceof StoreError && e.kind === 'conflict') throw new ConflictException(e.message)
      if (e instanceof StoreError && e.kind === 'not_found') throw new NotFoundException('That Xpert was not found.')
      throw e
    }
  }
}
