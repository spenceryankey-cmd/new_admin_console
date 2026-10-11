import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import {
  applyReferenceCall,
  approvalGaps,
  evidenceFacts,
  evidenceVerdict,
  guarantorCountdown,
  referenceWarnings,
  skillVerificationNudgeDue,
  type AddEvidenceInput,
  type AddGuarantorInput,
  type AddReferenceInput,
  type ApprovalQueueEntry,
  type CallbackInput,
  type EvidenceRecord,
  type GuarantorQueueEntry,
  type GuarantorRecord,
  type LogReferenceCallInput,
  type QueueEntry,
  type ReferenceRecord,
  type ReviewEvidenceInput,
} from '@beyondx/shared'
import type { StaffContext } from '../auth/staff-context'
import { ConfigService } from './config.service'
import { guarantorFacts } from './facts'
import { XPERT_STORE, type XpertStore } from './xpert.store'
import { XpertsService } from './xperts.service'

const QUEUE_LIMIT = 200

const brief = (x: { id: string; fullName: string; phone: string | null; status: any; verificationSource: any }) => ({
  id: x.id,
  fullName: x.fullName,
  phone: x.phone,
  status: x.status,
  verificationSource: x.verificationSource,
})

@Injectable()
export class ScreeningService {
  constructor(
    @Inject(XPERT_STORE) private readonly store: XpertStore,
    private readonly xperts: XpertsService,
    private readonly config: ConfigService,
  ) {}

  // Guarantors --------------------------------------------------------------------
  async addGuarantor(actor: StaffContext, xpertId: string, body: AddGuarantorInput): Promise<GuarantorRecord> {
    await this.xperts.mustGet(xpertId)
    if (await this.store.liveGuarantor(xpertId)) throw new ConflictException('This Xpert already has a guarantor. Retract that one first.')
    const g = await this.store.createGuarantor({
      xpertId,
      name: body.name,
      contact: body.contact,
      relationship: body.relationship ?? null,
      namedAt: null,
      actorId: actor.userId,
      reason: 'Guarantor entered by staff',
    })
    await this.xperts.afterScreeningEvent(xpertId)
    return g
  }

  private async mustGuarantor(id: string): Promise<GuarantorRecord> {
    const g = await this.store.guarantorById(id)
    if (!g) throw new NotFoundException('That guarantor was not found.')
    if (g.retractedAt) throw new ConflictException('That guarantor has been retracted.')
    return g
  }

  async markExplainerSent(actor: StaffContext, id: string): Promise<GuarantorRecord> {
    const g = await this.mustGuarantor(id)
    if (g.explainerMessageSentAt) return g
    return this.store.patchGuarantor(id, { explainer_sent_at: new Date().toISOString() }, actor.userId, 'Explainer message sent to the guarantor')
  }

  async recordCallback(actor: StaffContext, id: string, body: CallbackInput): Promise<GuarantorRecord> {
    const g = await this.mustGuarantor(id)
    const saved = await this.store.patchGuarantor(
      id,
      { callback_outcome: body.outcome, callback_note: body.note ?? null, callback_confirmed_at: body.outcome === 'yes' ? new Date().toISOString() : null },
      actor.userId,
      `Callback recorded: ${body.outcome.replace('_', ' ')}`,
    )
    const xpert = await this.xperts.mustGet(g.xpertId)
    if (xpert.status === 'guarantor_pending') {
      if (body.outcome === 'yes' && saved.explainerMessageSentAt) {
        await this.xperts.transition(actor, g.xpertId, { expectedFrom: 'guarantor_pending', to: 'guarantor_confirmed', trigger: 'guarantor_confirmed' })
        await this.xperts.afterScreeningEvent(g.xpertId)
      } else if (body.outcome === 'no') {
        await this.xperts.transition(actor, g.xpertId, {
          expectedFrom: 'guarantor_pending',
          to: 'blocked_closed',
          trigger: 'guarantor_declined',
          reason: body.note?.trim() || 'The guarantor said no on the callback.',
        })
      }
    }
    return saved
  }

  async retract(actor: StaffContext, id: string, reason: string): Promise<GuarantorRecord> {
    const g = await this.mustGuarantor(id)
    const saved = await this.store.patchGuarantor(id, { retracted_at: new Date().toISOString(), retracted_reason: reason }, actor.userId, reason)
    const xpert = await this.xperts.mustGet(g.xpertId)
    if (xpert.status === 'provisional_active' || xpert.status === 'full_active') {
      await this.xperts.transition(actor, g.xpertId, { expectedFrom: xpert.status, to: 'under_review', trigger: 'guarantor_retracted', reason })
    }
    return saved
  }

  // Evidence ------------------------------------------------------------------------
  async uploadUrl(xpertId: string, fileName: string) {
    await this.xperts.mustGet(xpertId)
    const safe = fileName.replace(/[^A-Za-z0-9._-]/g, '_').slice(-80)
    return this.store.signedUploadUrl(`${xpertId}/${randomUUID()}-${safe}`)
  }

  async addEvidence(actor: StaffContext, body: AddEvidenceInput): Promise<EvidenceRecord> {
    await this.xperts.mustGet(body.xpertId)
    if (body.filePath && !body.filePath.startsWith(`${body.xpertId}/`)) throw new BadRequestException('That file does not belong to this Xpert.')
    return this.store.createEvidence({
      xpertId: body.xpertId,
      taskType: body.taskType,
      evidenceType: body.evidenceType,
      link: body.link ?? null,
      filePath: body.filePath ?? null,
      actorId: actor.userId,
    })
  }

  async evidenceFile(id: string): Promise<{ url: string }> {
    const e = await this.store.evidenceById(id)
    if (!e) throw new NotFoundException('That evidence was not found.')
    if (!e.filePath) throw new BadRequestException('This evidence is a link, not a file.')
    return { url: await this.store.signedDownloadUrl(e.filePath) }
  }

  /** What the reviewer sees beside the evidence. */
  async evidenceChecklist(id: string) {
    const e = await this.store.evidenceById(id)
    if (!e) throw new NotFoundException('That evidence was not found.')
    return this.config.checklistFor(e.taskType)
  }

  async reviewEvidence(actor: StaffContext, id: string, body: ReviewEvidenceInput): Promise<EvidenceRecord> {
    const e = await this.store.evidenceById(id)
    if (!e) throw new NotFoundException('That evidence was not found.')
    if (e.reviewOutcome !== 'pending') throw new ConflictException('This evidence has already been reviewed. Add new evidence instead.')
    const { checklist } = await this.config.checklistFor(e.taskType)
    const verdict = evidenceVerdict({ checklist, ticked: body.ticked, autoFailHits: body.autoFailHits })
    if (body.outcome === 'pass' && verdict.allowedOutcome === 'fail') {
      throw new UnprocessableEntityException(`This cannot pass. ${verdict.reasons.join(' ')}`)
    }
    if (body.outcome === 'fail' && !(body.reason ?? '').trim() && verdict.allowedOutcome === 'pass') {
      throw new BadRequestException('Say why this evidence failed.')
    }
    const known = new Set(checklist.autoFail.map((a) => a.id))
    const saved = await this.store.patchEvidence(
      id,
      {
        review_outcome: body.outcome,
        checklist_ticked: body.ticked,
        auto_fail_hits: body.autoFailHits.filter((h) => known.has(h)),
        review_reason: body.reason ?? null,
        reviewed_by: actor.userId,
        reviewed_at: new Date().toISOString(),
      },
      actor.userId,
      `Evidence ${body.outcome}`,
    )
    await this.xperts.afterScreeningEvent(e.xpertId)
    return saved
  }

  // References ----------------------------------------------------------------------
  async addReference(actor: StaffContext, body: AddReferenceInput): Promise<ReferenceRecord> {
    await this.xperts.mustGet(body.xpertId)
    const g = await this.store.liveGuarantor(body.xpertId)
    return this.store.createReference({
      xpertId: body.xpertId,
      name: body.name,
      contact: body.contact,
      relationship: body.relationship,
      warnings: referenceWarnings(body, g),
      actorId: actor.userId,
    })
  }

  async referenceScript() {
    return this.config.referenceScript()
  }

  async logReferenceCall(actor: StaffContext, id: string, body: LogReferenceCallInput): Promise<ReferenceRecord> {
    const ref = await this.store.referenceById(id)
    if (!ref) throw new NotFoundException('That reference was not found.')
    if (ref.outcome === 'confirmed' || ref.outcome === 'unreachable') throw new ConflictException('This reference is already closed.')
    const { config } = await this.config.screening()
    const next = applyReferenceCall({ attempts: ref.attemptsMade, outcome: ref.outcome }, body.result, config)
    const at = new Date().toISOString()
    const saved = await this.store.patchReference(
      id,
      {
        outcome: next.outcome,
        attempts_made: next.attempts,
        called_by: actor.userId,
        called_at: at,
        call_log: [...ref.callLog, { at, by: actor.userId, byName: actor.fullName, result: body.result, note: body.note ?? null }],
      },
      actor.userId,
      `Reference call: ${body.result.replace('_', ' ')}`,
    )
    await this.xperts.afterScreeningEvent(ref.xpertId)
    return saved
  }

  // Queues --------------------------------------------------------------------------
  async guarantorQueue(): Promise<{ entries: GuarantorQueueEntry[] }> {
    const xs = await this.store.xpertsByStatus('guarantor_pending', QUEUE_LIMIT)
    const gs = await this.store.guarantorsFor(xs.map((x) => x.id))
    const { config } = await this.config.screening()
    const now = new Date()
    const entries = xs
      .map((x) => ({ x, g: gs.get(x.id) }))
      .filter((r): r is { x: typeof r.x; g: GuarantorRecord } => !!r.g)
      .map(({ x, g }) => ({
        item: g,
        xpert: brief(x),
        waitingSince: g.namedAt,
        countdown: guarantorCountdown({ namedAt: g.namedAt }, now, config.guarantorDeadlineDays),
      }))
      .sort((a, b) => a.waitingSince.localeCompare(b.waitingSince))
    return { entries }
  }

  private async withXperts<T extends { xpertId: string }>(items: T[], since: (t: T) => string): Promise<QueueEntry<T>[]> {
    const xs = await this.store.xpertsByIds([...new Set(items.map((i) => i.xpertId))])
    return items.flatMap((item) => {
      const x = xs.get(item.xpertId)
      return x ? [{ item, xpert: brief(x), waitingSince: since(item) }] : []
    })
  }

  async evidenceQueue(): Promise<{ entries: QueueEntry<EvidenceRecord>[] }> {
    return { entries: await this.withXperts(await this.store.pendingEvidence(QUEUE_LIMIT), (e) => e.createdAt) }
  }

  async referenceQueue(): Promise<{ entries: QueueEntry<ReferenceRecord>[] }> {
    return { entries: await this.withXperts(await this.store.pendingReferences(QUEUE_LIMIT), (r) => r.createdAt) }
  }

  async approvalQueue(): Promise<{ entries: ApprovalQueueEntry[] }> {
    const xs = await this.store.xpertsByStatus('skill_verification', QUEUE_LIMIT)
    const ids = xs.map((x) => x.id)
    const [gs, since, evidence, { config }] = await Promise.all([
      this.store.guarantorsFor(ids),
      this.store.lastEntered(ids, 'skill_verification'),
      Promise.all(xs.map((x) => this.store.evidenceFor(x.id))),
      this.config.screening(),
    ])
    const now = new Date()
    const entries = xs.map((x, i): ApprovalQueueEntry => {
      const g = gs.get(x.id) ?? null
      const ev = evidenceFacts(evidence[i]!.map((e) => ({ review_outcome: e.reviewOutcome })))
      const gaps = approvalGaps(guarantorFacts(g), ev)
      const entered = since.get(x.id) ?? x.createdAt ?? now.toISOString()
      return {
        xpert: brief(x),
        waitingSince: entered,
        guarantor: g,
        evidence: ev,
        gaps,
        ready: gaps.length === 0,
        nudgeDue: skillVerificationNudgeDue(entered, now, config),
      }
    })
    entries.sort((a, b) => Number(b.ready) - Number(a.ready) || a.waitingSince.localeCompare(b.waitingSince))
    return { entries }
  }

  /** Take or hand back an item so two people do not work the same one. */
  async claim(actor: StaffContext, kind: 'guarantors' | 'evidence' | 'references', id: string, release: boolean) {
    const current =
      kind === 'guarantors' ? await this.store.guarantorById(id) : kind === 'evidence' ? await this.store.evidenceById(id) : await this.store.referenceById(id)
    if (!current) throw new NotFoundException('That item was not found.')
    if (!release && current.assignedTo && current.assignedTo !== actor.userId) {
      throw new ConflictException(`${current.assignedToName ?? 'Someone else'} is already working on this.`)
    }
    if (release && current.assignedTo && current.assignedTo !== actor.userId && actor.role !== 'super_admin') {
      throw new ConflictException('Only the person working on this, or a super admin, can hand it back.')
    }
    const patch = release ? { assigned_to: null, assigned_at: null } : { assigned_to: actor.userId, assigned_at: new Date().toISOString() }
    const why = release ? 'Handed back to the queue' : 'Claimed'
    if (kind === 'guarantors') return this.store.patchGuarantor(id, patch, actor.userId, why)
    if (kind === 'evidence') return this.store.patchEvidence(id, patch, actor.userId, why)
    return this.store.patchReference(id, patch, actor.userId, why)
  }
}
