import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import {
  JOB_OPEN,
  canPromote,
  canReplace,
  jobMove,
  noShowLimitReached,
  pairProblem,
  matchXpert,
  watchJob,
  type ChangeOrderInput,
  type ChangeOrderStatus,
  type JobCounts,
  type JobDetail,
  type JobListQuery,
  type JobRecord,
  type Match,
  type NoShowResult,
  type RecurringInput,
} from '@beyondx/shared'
import type { StaffContext } from '../auth/staff-context'
import { ConfigService } from '../xperts/config.service'
import { StoreError, XPERT_STORE, type XpertStore } from '../xperts/xpert.store'
import { XpertsService } from '../xperts/xperts.service'
import { JOB_STORE, type JobRow, type JobStore } from './job.store'

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
export class JobsService {
  constructor(
    @Inject(JOB_STORE) private readonly store: JobStore,
    @Inject(XPERT_STORE) private readonly xperts: XpertStore,
    private readonly config: ConfigService,
    private readonly xpertsService: XpertsService,
  ) {}

  private async decorate(rows: JobRow[]): Promise<JobRecord[]> {
    const mon = await this.config.monitor()
    const names = await this.xperts.xpertsByIds([...new Set(rows.flatMap((r) => [r.xpertId, r.backupXpertId]).filter((x): x is string => !!x))])
    const now = new Date()
    return rows.map((r) => ({
      ...r,
      xpertName: r.xpertId ? (names.get(r.xpertId)?.fullName ?? null) : null,
      backupXpertName: r.backupXpertId ? (names.get(r.backupXpertId)?.fullName ?? null) : null,
      watch: watchJob(r, now, mon),
    }))
  }

  async list(q: JobListQuery) {
    const { rows, total } = await this.store.listJobs(q)
    return { jobs: await this.decorate(rows), total }
  }

  private async mustGet(id: string): Promise<JobRow> {
    const j = await this.store.getJob(id)
    if (!j) throw new NotFoundException('That job was not found.')
    return j
  }

  /** Xperts who could take the job, best first. */
  async matches(job: JobRow): Promise<Match[]> {
    const [prov, full] = await Promise.all([this.xperts.xpertsByStatus('provisional_active', 500), this.xperts.xpertsByStatus('full_active', 500)])
    const pool = [...full, ...prov]
    const [load, bands] = await Promise.all([this.store.activeLoad(pool.map((x) => x.id)), this.store.bandsFor(job.category)])
    return pool
      .map((x) => matchXpert({ job: { category: job.category, location: job.location, amountGhs: job.amountGhs }, xpert: x, band: bands.get(x.id) ?? null, activeJobs: load.get(x.id) ?? 0 }))
      .filter((m): m is Match => !!m)
      .sort((a, b) => b.score - a.score || a.fullName.localeCompare(b.fullName))
  }

  async detail(id: string): Promise<JobDetail> {
    const row = await this.mustGet(id)
    const [[job], assignments, changeOrders, paymentStatus] = await Promise.all([this.decorate([row]), this.store.assignmentsFor(id), this.store.changeOrders({ jobId: id }), this.store.paymentStatus(row.paymentId)])
    const names = await this.xperts.xpertsByIds([...new Set(assignments.map((a) => a.xpertId))])
    return {
      job: job!,
      assignments: assignments.map((a) => ({ ...a, xpertName: names.get(a.xpertId)?.fullName ?? null })),
      changeOrders,
      paymentStatus: paymentStatus as JobDetail['paymentStatus'],
      matches: row.status === 'awaiting_dispatch' || canReplace(row.status) ? (await this.matches(row)).filter((m) => m.xpertId !== row.xpertId && m.xpertId !== row.backupXpertId) : [],
    }
  }

  private async mustBeMatch(job: JobRow, xpertId: string) {
    const x = await this.xperts.getXpert(xpertId)
    if (!x) throw new BadRequestException('That Xpert was not found.')
    if (x.status !== 'provisional_active' && x.status !== 'full_active') throw new UnprocessableEntityException('Only an active Xpert can be put on a job.')
    if (!x.accountActive) throw new UnprocessableEntityException('That Xpert is marked inactive.')
    const m = (await this.matches(job)).find((r) => r.xpertId === xpertId)
    if (!m) throw new UnprocessableEntityException('That Xpert does not list this category as a skill.')
  }

  async dispatch(actor: StaffContext, id: string, xpertId: string, backupXpertId: string) {
    const job = await this.mustGet(id)
    if (!jobMove(job.status, 'dispatched')) throw new ConflictException(`A job that is ${job.status} cannot be dispatched.`)
    const problem = pairProblem(xpertId, backupXpertId)
    if (problem) throw new BadRequestException(problem)
    await this.mustBeMatch(job, xpertId)
    await this.mustBeMatch(job, backupXpertId)
    await guard(() => this.store.rpcDispatch(id, xpertId, backupXpertId, actor.userId))
    return this.detail(id)
  }
  /** Add a backup to a live job that has none, or change it (a reason is needed to change one). */
  async setBackup(actor: StaffContext, id: string, xpertId: string, reason: string | undefined) {
    const job = await this.mustGet(id)
    if (!canPromote(job.status)) throw new ConflictException(`A job that is ${job.status} cannot take a backup.`)
    if (job.xpertId === xpertId) throw new ConflictException('The backup must be a different Xpert from the primary.')
    if (job.backupXpertId === xpertId) throw new ConflictException('That Xpert is already the backup.')
    if (job.backupXpertId && (reason ?? '').trim().length < 3) throw new BadRequestException('Give a reason to change the backup.')
    await this.mustBeMatch(job, xpertId)
    await guard(() => this.store.rpcSetBackup(id, xpertId, reason?.trim() || null, actor.userId))
    return this.detail(id)
  }
  async promoteBackup(actor: StaffContext, id: string, reason: string) {
    const job = await this.mustGet(id)
    if (!canPromote(job.status)) throw new ConflictException(`A job that is ${job.status} has no primary Xpert to replace.`)
    if (!job.backupXpertId) throw new ConflictException('This job has no backup to promote.')
    await guard(() => this.store.rpcPromoteBackup(id, reason, actor.userId))
    return this.detail(id)
  }
  /**
   * The primary did not turn up. The database promotes the backup, or sends the job back to Needs an Xpert,
   * and counts this Xpert's no shows in the window. When the limit is reached the Xpert goes to Under Review
   * through the one status function. That move lives in the hetzner database, so it cannot share the job
   * transaction. If it fails, the hourly sweep makes the same move (reviewNoShows).
   */
  async noShow(actor: StaffContext, id: string, note: string | undefined): Promise<JobDetail & { noShow: NoShowResult }> {
    const job = await this.mustGet(id)
    if (!canPromote(job.status)) throw new ConflictException(`A job that is ${job.status} has no primary Xpert.`)
    const o = await guard(() => this.store.rpcNoShow(id, note?.trim() || null, actor.userId))
    let sentToReview = false
    if (noShowLimitReached(o.noShowsInWindow, o.limit)) sentToReview = await this.moveToReview(o.noShowXpertId, o.noShowsInWindow, o.windowDays)
    const noShow: NoShowResult = { promotedXpertId: o.promotedXpertId, noShowXpertId: o.noShowXpertId, noShowsInWindow: o.noShowsInWindow, limit: o.limit, windowDays: o.windowDays, sentToReview }
    return { ...(await this.detail(id)), noShow }
  }
  private async moveToReview(xpertId: string, count: number, windowDays: number): Promise<boolean> {
    try {
      return await this.xpertsService.system(xpertId, 'under_review', 'no_shows', `${count} no shows within ${windowDays} days`)
    } catch {
      return false
    }
  }
  /** Repairs a missed review: any active Xpert at or over the no show limit is moved to Under Review. */
  async reviewNoShows(): Promise<number> {
    let n = 0
    for (const x of await this.store.noShowsOverLimit()) if (await this.xpertsService.system(x.xpertId, 'under_review', 'no_shows', `${x.count} no shows within ${x.windowDays} days`)) n++
    return n
  }
  async start(actor: StaffContext, id: string) {
    await guard(() => this.store.rpcStart(id, actor.userId))
    return this.detail(id)
  }
  async replace(actor: StaffContext, id: string, xpertId: string, reason: string) {
    const job = await this.mustGet(id)
    if (!canReplace(job.status)) throw new ConflictException(`A job that is ${job.status} has no Xpert to replace.`)
    if (job.xpertId === xpertId) throw new ConflictException('That Xpert is already on the job.')
    if (job.backupXpertId === xpertId) throw new ConflictException('That Xpert is the backup. Use Promote backup instead.')
    await this.mustBeMatch(job, xpertId)
    await guard(() => this.store.rpcReplace(id, xpertId, reason, actor.userId))
    return this.detail(id)
  }
  async confirm(actor: StaffContext, id: string, side: 'employer' | 'xpert') {
    await guard(() => this.store.rpcConfirm(id, side, actor.userId))
    return this.detail(id)
  }
  async cancel(actor: StaffContext, id: string, reason: string) {
    await guard(() => this.store.rpcCancel(id, reason, actor.userId))
    return this.detail(id)
  }

  // Change orders -----------------------------------------------------------------------
  changeOrders(f: { status?: ChangeOrderStatus; jobId?: string }) {
    return this.store.changeOrders(f)
  }
  async logChangeOrder(actor: StaffContext, i: ChangeOrderInput) {
    const job = await this.mustGet(i.jobId)
    if (!JOB_OPEN.includes(job.status) || job.status === 'awaiting_dispatch') throw new ConflictException('Change orders can be logged once an Xpert is on the job and until it is completed.')
    return guard(() => this.store.createChangeOrder(i, actor.userId))
  }
  async confirmChange(actor: StaffContext, id: string, side: 'employer' | 'xpert') {
    await guard(() => this.store.rpcConfirmChange(id, side, actor.userId))
    return (await this.store.changeOrderById(id))!
  }
  async rejectChange(actor: StaffContext, id: string, side: 'employer' | 'xpert', note: string) {
    await guard(() => this.store.rpcRejectChange(id, side, note, actor.userId))
    return (await this.store.changeOrderById(id))!
  }
  async cancelChange(actor: StaffContext, id: string, reason: string) {
    await guard(() => this.store.cancelChange(id, actor.userId, reason))
    return (await this.store.changeOrderById(id))!
  }

  // Recurring ---------------------------------------------------------------------------
  recurring() {
    return this.store.recurring()
  }
  createRecurring(actor: StaffContext, i: RecurringInput) {
    return this.store.createRecurring(i, actor.userId)
  }
  setRecurring(actor: StaffContext, id: string, active: boolean, reason: string) {
    return guard(() => this.store.setRecurringActive(id, active, actor.userId, reason))
  }
  async generate(actor: StaffContext | null, id: string) {
    await guard(() => this.store.rpcGenerate(id, actor?.userId ?? null))
  }
  /** Generate every request that has come due. Safe to repeat: the due date moves forward. */
  async generateDue(): Promise<number> {
    let n = 0
    for (const r of await this.store.recurring()) {
      if (!r.due) continue
      try {
        await this.store.rpcGenerate(r.id, null)
        n++
      } catch (e) {
        if (!(e instanceof StoreError && e.kind === 'conflict')) throw e
      }
    }
    return n
  }

  async counts(): Promise<JobCounts> {
    const [c, open, rec] = await Promise.all([this.store.counts(), this.store.openJobs(), this.store.recurring()])
    const rows = await this.decorate(open)
    return { ...c, needsAttention: rows.filter((r) => r.watch).length, recurringDue: rec.filter((r) => r.due).length }
  }
  async attention(): Promise<JobRecord[]> {
    return (await this.decorate(await this.store.openJobs())).filter((r) => r.watch)
  }
}
