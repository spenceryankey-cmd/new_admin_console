import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import {
  EMPTY_RELIABILITY,
  FLAG_OPEN,
  can,
  reviewTriggerFor,
  type CoordinatorDetail,
  type CoordinatorInput,
  type CoordinatorMetrics,
  type CoordinatorSummary,
  type CounterFlagInput,
  type DecideFlagInput,
  type FeedbackInput,
  type FlagDetail,
  type FlagListQuery,
  type FlagRecord,
  type RaiseFlagInput,
  type ReliabilityRecord,
} from '@beyondx/shared'
import type { StaffContext } from '../auth/staff-context'
import { StoreError, XPERT_STORE, type XpertStore } from '../xperts/xpert.store'
import { XpertsService } from '../xperts/xperts.service'
import { TRUST_STORE, type TrustStore } from './trust.store'

async function guard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (e) {
    if (e instanceof StoreError && e.kind === 'conflict') throw new ConflictException(e.message)
    if (e instanceof StoreError && e.kind === 'not_found') throw new NotFoundException(e.message)
    throw e
  }
}

@Injectable()
export class TrustService {
  constructor(
    @Inject(TRUST_STORE) private readonly store: TrustStore,
    @Inject(XPERT_STORE) private readonly xperts: XpertStore,
    private readonly xpertsSvc: XpertsService,
  ) {}

  // Flags ---------------------------------------------------------------------------------
  private async named(rows: FlagRecord[]): Promise<FlagRecord[]> {
    const names = await this.xperts.xpertsByIds([...new Set(rows.map((r) => r.xpertId))])
    return rows.map((r) => ({ ...r, xpertName: names.get(r.xpertId)?.fullName ?? null }))
  }

  async listFlags(q: FlagListQuery) {
    const { rows, total } = await this.store.listFlags(q)
    return { flags: await this.named(rows), total }
  }

  async flagDetail(id: string): Promise<FlagDetail> {
    const f = await this.store.flagById(id)
    if (!f || f.kind !== 'flag') throw new NotFoundException('That flag was not found.')
    const [[flag], counters, rel] = await Promise.all([this.named([f]), this.store.countersFor(id).then((c) => this.named(c)), this.store.reliability([f.xpertId])])
    return { flag: flag!, counters, reliability: rel.get(f.xpertId) ?? EMPTY_RELIABILITY(f.xpertId) }
  }

  async raise(actor: StaffContext, i: RaiseFlagInput) {
    if (!(await this.xperts.getXpert(i.xpertId))) throw new BadRequestException('That Xpert was not found.')
    if (i.jobId) {
      const job = await this.store.jobInfo(i.jobId)
      if (!job) throw new BadRequestException('That job was not found.')
    }
    const f = await guard(() => this.store.createFlag(i, actor.userId))
    return this.flagDetail(f.id)
  }

  async counter(actor: StaffContext, id: string, i: CounterFlagInput) {
    const parent = await this.store.flagById(id)
    if (!parent || parent.kind !== 'flag') throw new NotFoundException('That flag was not found.')
    if (!FLAG_OPEN.includes(parent.status)) throw new ConflictException('This flag has been decided. A counter flag can only be added before that.')
    await guard(() => this.store.createCounter(parent, i, actor.userId))
    return this.flagDetail(id)
  }

  async investigate(actor: StaffContext, id: string) {
    await guard(() => this.store.rpcInvestigate(id, actor.userId))
    return this.flagDetail(id)
  }

  async decide(actor: StaffContext, id: string, i: DecideFlagInput) {
    const before = await this.store.flagById(id)
    if (!before || before.kind !== 'flag') throw new NotFoundException('That flag was not found.')
    if (i.sendToReview && i.outcome !== 'upheld') throw new BadRequestException('Only an upheld flag can send an Xpert to Under Review.')
    if (i.sendToReview && !can(actor, 'xperts.status.decide')) throw new ForbiddenException('Your role cannot change an Xpert\'s status.')
    await guard(() => this.store.rpcDecide(id, i.outcome, i.note, actor.userId))
    if (i.sendToReview) {
      const x = await this.xperts.getXpert(before.xpertId)
      if (x && (x.status === 'provisional_active' || x.status === 'full_active')) {
        await this.xpertsSvc.transition(actor, x.id, { expectedFrom: x.status, to: 'under_review', trigger: reviewTriggerFor(before.category), reason: i.note })
      }
    }
    // An upheld flag can make a job unclean, so the promotion count is rechecked from the records.
    return this.flagDetail(id)
  }

  // Feedback ------------------------------------------------------------------------------
  async listFeedback(f: { limit: number; offset: number; xpertId?: string }) {
    const { rows, total } = await this.store.feedbackList(f)
    const names = await this.xperts.xpertsByIds([...new Set(rows.map((r) => r.xpertId).filter((x): x is string => !!x))])
    return { feedback: rows.map((r) => ({ ...r, xpertName: r.xpertId ? (names.get(r.xpertId)?.fullName ?? null) : null })), total }
  }

  async logFeedback(actor: StaffContext, i: FeedbackInput) {
    const job = await this.store.jobInfo(i.jobId)
    if (!job) throw new BadRequestException('That job was not found.')
    if (job.status !== 'completed') throw new ConflictException('Feedback can be logged once the job is completed.')
    const rec = await guard(() => this.store.createFeedback(i, actor.userId))
    // New employer feedback can make a completed job clean, which can lift a provisional Xpert to fully active.
    if (job.xpertId && i.side === 'employer') await this.xpertsSvc.afterScreeningEvent(job.xpertId)
    return rec
  }

  // Reliability ---------------------------------------------------------------------------
  async reliability(xpertId: string): Promise<ReliabilityRecord> {
    if (!(await this.xperts.getXpert(xpertId))) throw new NotFoundException('That Xpert was not found.')
    return (await this.store.reliability([xpertId])).get(xpertId) ?? EMPTY_RELIABILITY(xpertId)
  }

  // Coordinators --------------------------------------------------------------------------
  private async metrics(coordinatorId: string): Promise<{ metrics: CoordinatorMetrics; roster: CoordinatorDetail['roster'] }> {
    const ids = await this.store.roster(coordinatorId)
    const [xs, rel, jobs] = await Promise.all([this.xperts.xpertsByIds(ids), this.store.reliability(ids), this.store.coordinatorJobStats(coordinatorId)])
    const roster = ids.map((id) => {
      const x = xs.get(id)
      return { xpertId: id, fullName: x?.fullName ?? null, status: x?.status ?? null, verificationSource: x?.verificationSource ?? null, reliability: rel.get(id) ?? EMPTY_RELIABILITY(id) }
    })
    const byStatus: Record<string, number> = {}
    for (const r of roster) byStatus[r.status ?? 'unknown'] = (byStatus[r.status ?? 'unknown'] ?? 0) + 1
    const rated = roster.filter((r) => r.reliability.avgRating !== null)
    const weight = rated.reduce((s, r) => s + r.reliability.jobsCompleted, 0)
    const avg = weight > 0 ? rated.reduce((s, r) => s + r.reliability.avgRating! * r.reliability.jobsCompleted, 0) / weight : null
    return {
      roster,
      metrics: {
        xperts: roster.length,
        activeXperts: roster.filter((r) => r.status === 'provisional_active' || r.status === 'full_active').length,
        byStatus,
        jobsCompleted: roster.reduce((s, r) => s + r.reliability.jobsCompleted, 0),
        cleanJobs: roster.reduce((s, r) => s + r.reliability.cleanJobs, 0),
        avgRating: avg === null ? null : Math.round(avg * 100) / 100,
        flagsUpheld: roster.reduce((s, r) => s + r.reliability.flagsUpheld, 0),
        jobsLive: jobs.live,
      },
    }
  }

  async coordinators(): Promise<CoordinatorSummary[]> {
    const list = await this.store.coordinators()
    return Promise.all(list.map(async (c) => ({ ...c, metrics: (await this.metrics(c.id)).metrics })))
  }
  async coordinatorDetail(id: string): Promise<CoordinatorDetail> {
    const c = await this.store.coordinatorById(id)
    if (!c) throw new NotFoundException('That coordinator was not found.')
    return { coordinator: c, ...(await this.metrics(id)) }
  }
  createCoordinator(actor: StaffContext, i: CoordinatorInput) {
    return this.store.createCoordinator(i, actor.userId)
  }
  async setCoordinatorActive(actor: StaffContext, id: string, active: boolean, reason: string) {
    await guard(() => this.store.setCoordinatorActive(id, active, actor.userId, reason))
    return this.coordinatorDetail(id)
  }
  async assign(actor: StaffContext, id: string, xpertId: string, reason: string) {
    const c = await this.store.coordinatorById(id)
    if (!c) throw new NotFoundException('That coordinator was not found.')
    if (!c.active) throw new ConflictException('That coordinator is inactive.')
    if (!(await this.xperts.getXpert(xpertId))) throw new BadRequestException('That Xpert was not found.')
    await guard(() => this.store.assignXpert(id, xpertId, actor.userId, reason))
    return this.coordinatorDetail(id)
  }

  counts() {
    return this.store.counts()
  }
}
