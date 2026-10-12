import { randomUUID } from 'node:crypto'
import { SERVICE_CATEGORIES, EMPTY_RELIABILITY, isCleanJob, type CoordinatorRecord, type FeedbackRecord, type FlagRecord, type ReliabilityRecord } from '@beyondx/shared'
import type { FakeJobStore } from '../jobs/fake.job.store'
import { StoreError } from '../xperts/xpert.store'
import type { FakeStore } from '../xperts/fake.store'
import type { TrustStore } from './trust.store'

/** In memory stand in. Reliability is computed from the other fakes with the same rule the SQL view uses. */
export class FakeTrustStore implements TrustStore {
  flags: FlagRecord[] = []
  feedback: (FeedbackRecord & { jobId: string })[] = []
  coords: CoordinatorRecord[] = []
  rosterRows: { coordinatorId: string; xpertId: string; active: boolean }[] = []

  constructor(private readonly jobs: FakeJobStore, private readonly xperts?: FakeStore) {}

  async listFlags(f: { status?: string; xpertId?: string; limit: number; offset: number }) {
    let rows = this.flags.filter((x) => x.kind === 'flag')
    if (f.status) rows = rows.filter((x) => x.status === f.status)
    if (f.xpertId) rows = rows.filter((x) => x.xpertId === f.xpertId)
    return { rows: rows.slice(f.offset, f.offset + f.limit), total: rows.length }
  }
  async flagById(id: string) { return this.flags.find((x) => x.id === id) ?? null }
  async countersFor(id: string) { return this.flags.filter((x) => x.parentFlagId === id) }
  async createFlag(i: any, actorId: string) {
    void actorId
    const f: FlagRecord = { id: randomUUID(), xpertId: i.xpertId, xpertName: null, jobId: i.jobId ?? null, kind: 'flag', parentFlagId: null, raisedBy: i.raisedBy ?? 'staff', raisedByStaffName: null, category: i.category, detail: i.detail, status: 'open', decidedByName: null, decidedAt: null, decisionNote: null, createdAt: new Date().toISOString() }
    this.flags.push(f)
    return f
  }
  async createCounter(parent: FlagRecord, i: any) {
    const f: FlagRecord = { ...parent, id: randomUUID(), kind: 'counter_flag', parentFlagId: parent.id, raisedBy: i.raisedBy, detail: i.detail, status: 'open', decidedAt: null, decidedByName: null, decisionNote: null, createdAt: new Date().toISOString() }
    this.flags.push(f)
    return f
  }
  async rpcInvestigate(id: string) {
    const f = this.flags.find((x) => x.id === id)
    if (!f) throw new StoreError('not_found', 'Not found')
    if (f.kind !== 'flag' || f.status !== 'open') throw new StoreError('conflict', `This flag is now ${f.status}.`)
    f.status = 'investigating'
  }
  async rpcDecide(id: string, outcome: 'upheld' | 'dismissed', note: string) {
    const f = this.flags.find((x) => x.id === id)
    if (!f) throw new StoreError('not_found', 'Not found')
    if (f.kind !== 'flag' || (f.status !== 'open' && f.status !== 'investigating')) throw new StoreError('conflict', `This flag is now ${f.status}.`)
    Object.assign(f, { status: outcome, decisionNote: note, decidedAt: new Date().toISOString() })
    for (const c of this.flags) if (c.parentFlagId === id && c.status === 'open') c.status = 'reviewed'
  }

  async jobInfo(jobId: string) {
    const j = this.jobs.jobs.get(jobId)
    return j ? { id: j.id, xpertId: j.xpertId, status: j.status, category: j.category, location: j.location, coordinatorId: j.coordinatorId } : null
  }
  async feedbackList(f: { limit: number; offset: number; xpertId?: string }) {
    let rows = this.feedback
    if (f.xpertId) rows = rows.filter((x) => x.xpertId === f.xpertId)
    return { rows: rows.slice(f.offset, f.offset + f.limit), total: rows.length }
  }
  async createFeedback(i: any) {
    if (this.feedback.some((x) => x.jobId === i.jobId && x.side === i.side)) throw new StoreError('conflict', 'Feedback from that side has already been logged for this job.')
    const j = this.jobs.jobs.get(i.jobId)!
    const r = { id: randomUUID(), jobId: i.jobId, jobLabel: `${j.category}, ${j.location}`, xpertId: j.xpertId, xpertName: null, side: i.side, rating: i.rating, onTime: i.onTime ?? null, wouldRepeat: i.wouldRepeat ?? null, comment: i.comment ?? null, reasons: i.reasons ?? [], taskTypeCode: i.taskTypeCode ?? null, taskTypeLabel: SERVICE_CATEGORIES.flatMap((c) => c.tasks).find((t) => t.code === i.taskTypeCode)?.label ?? null, createdAt: new Date().toISOString(), loggedByName: null }
    this.feedback.push(r)
    // Keep the Xpert fake in step, as the database view would be.
    await this.syncClean(j.xpertId)
    return r
  }
  async syncClean(xpertId: string | null) {
    if (!xpertId || !this.xperts) return
    this.xperts.clean.set(xpertId, (await this.reliability([xpertId])).get(xpertId)?.cleanJobs ?? 0)
  }

  async reliability(ids: string[]) {
    const out = new Map<string, ReliabilityRecord>()
    for (const id of ids) {
      const r = EMPTY_RELIABILITY(id)
      const mine = [...this.jobs.jobs.values()].filter((j) => j.xpertId === id && j.status === 'completed')
      const ratings: number[] = []
      const onTime: boolean[] = []
      for (const j of mine) {
        r.jobsCompleted++
        const fb = this.feedback.find((x) => x.jobId === j.id && x.side === 'employer')
        if (fb) { ratings.push(fb.rating); if (fb.onTime !== null) onTime.push(fb.onTime) }
        const upheld = this.flags.filter((x) => x.kind === 'flag' && x.jobId === j.id && x.status === 'upheld').length
        if (isCleanJob({ completed: true, employerRating: fb?.rating ?? null, onTime: fb?.onTime ?? null, upheldFlags: upheld })) r.cleanJobs++
      }
      r.avgRating = ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 100) / 100 : null
      r.onTimeRate = onTime.length ? Math.round((onTime.filter(Boolean).length / onTime.length) * 100) / 100 : null
      for (const a of this.jobs.assignments) if (a.xpertId === id) { if (a.status === 'replaced') r.timesReplaced++; if (a.status === 'withdrawn') r.jobsWithdrawn++ }
      for (const f of this.flags) if (f.kind === 'flag' && f.xpertId === id) { if (f.status === 'upheld') r.flagsUpheld++; if (f.status === 'open' || f.status === 'investigating') r.flagsOpen++ }
      out.set(id, r)
    }
    return out
  }

  async coordinators() { return this.coords }
  async coordinatorById(id: string) { return this.coords.find((c) => c.id === id) ?? null }
  async createCoordinator(i: any) {
    const c: CoordinatorRecord = { id: randomUUID(), fullName: i.fullName, phone: i.phone ?? null, area: i.area ?? null, active: true, note: i.note ?? null, createdAt: new Date().toISOString() }
    this.coords.push(c)
    return c
  }
  async setCoordinatorActive(id: string, active: boolean) {
    const c = this.coords.find((x) => x.id === id)
    if (!c) throw new StoreError('not_found', 'Not found')
    c.active = active
  }
  async roster(id: string) { return this.rosterRows.filter((r) => r.coordinatorId === id && r.active).map((r) => r.xpertId) }
  async assignXpert(coordinatorId: string, xpertId: string) {
    for (const r of this.rosterRows) if (r.xpertId === xpertId) r.active = false
    this.rosterRows.push({ coordinatorId, xpertId, active: true })
  }
  async coordinatorJobStats(id: string) {
    const mine = [...this.jobs.jobs.values()].filter((j) => j.coordinatorId === id)
    return { live: mine.filter((j) => j.status === 'dispatched' || j.status === 'in_progress').length, completed: mine.filter((j) => j.status === 'completed').length }
  }
  async counts() { return { flagsOpen: this.flags.filter((f) => f.kind === 'flag' && (f.status === 'open' || f.status === 'investigating')).length, feedbackThisWeek: this.feedback.length } }
  async staffNames() { return new Map<string, string>() }
}
