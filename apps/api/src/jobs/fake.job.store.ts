import { randomUUID } from 'node:crypto'
import type { AssignmentRecord, ChangeOrderRecord, ChangeOrderStatus, JobStatus, PaymentRecord, RecurringRecord } from '@beyondx/shared'
import type { FakeRequestStore } from '../requests/fake.request.store'
import { StoreError } from '../xperts/xpert.store'
import type { JobRow, JobStore } from './job.store'

/** In memory stand in for tests and the development mock. It mirrors the SQL functions' rules. */
export class FakeJobStore implements JobStore {
  jobs = new Map<string, JobRow>()
  assignments: AssignmentRecord[] = []
  changes: ChangeOrderRecord[] = []
  recurringRows: RecurringRecord[] = []
  bandRows: { xpertId: string; category: string; minGhs: number; maxGhs: number }[] = []

  constructor(private readonly reqs: FakeRequestStore) {
    reqs.onReceived = (p: PaymentRecord) => this.fromPayment(p)
  }

  private fromPayment(p: PaymentRecord) {
    if ([...this.jobs.values()].some((j) => j.requestId === p.requestId)) return
    const r = this.reqs.requests.get(p.requestId)!
    const j: JobRow = { id: randomUUID(), requestId: r.id, paymentId: p.id, recurringId: null, category: r.category, location: r.location, timing: r.timing, amountGhs: p.amountGhs, status: 'awaiting_dispatch', xpertId: null, employerName: r.employerName, employerPhone: r.employerPhone, dispatchedAt: null, startedAt: null, employerConfirmedAt: null, xpertConfirmedAt: null, completedAt: null, cancelledReason: null, createdAt: new Date().toISOString(), coordinatorId: null }
    this.jobs.set(j.id, j)
  }
  private need(id: string) {
    const j = this.jobs.get(id)
    if (!j) throw new StoreError('not_found', 'Not found')
    return j
  }
  private expect(j: JobRow, ...s: JobStatus[]) {
    if (!s.includes(j.status)) throw new StoreError('conflict', `This job is now ${j.status}. Reload and try again.`)
  }

  async listJobs(f: { status?: JobStatus; q?: string; limit: number; offset: number }) {
    let rows = [...this.jobs.values()]
    if (f.status) rows = rows.filter((j) => j.status === f.status)
    if (f.q) rows = rows.filter((j) => `${j.category} ${j.location}`.toLowerCase().includes(f.q!.toLowerCase()))
    return { rows: rows.slice(f.offset, f.offset + f.limit), total: rows.length }
  }
  async getJob(id: string) { return this.jobs.get(id) ?? null }
  async openJobs() { return [...this.jobs.values()].filter((j) => j.status === 'dispatched' || j.status === 'in_progress') }
  async assignmentsFor(jobId: string) { return this.assignments.filter((a) => a.jobId === jobId) }
  async activeLoad(ids: string[]) {
    const m = new Map<string, number>()
    for (const a of this.assignments) if (a.status === 'active' && ids.includes(a.xpertId)) m.set(a.xpertId, (m.get(a.xpertId) ?? 0) + 1)
    return m
  }
  async bandsFor(category: string) {
    return new Map(this.bandRows.filter((b) => b.category.toLowerCase() === category.toLowerCase()).map((b) => [b.xpertId, { minGhs: b.minGhs, maxGhs: b.maxGhs }]))
  }
  async paymentStatus(paymentId: string) { return this.reqs.payments.find((p) => p.id === paymentId)?.status ?? null }

  private addAssignment(jobId: string, xpertId: string) {
    this.assignments.push({ id: randomUUID(), jobId, xpertId, xpertName: null, status: 'active', assignedAt: new Date().toISOString(), endedAt: null, endReason: null, assignedByName: null })
  }
  private endActive(jobId: string, status: AssignmentRecord['status'], reason: string | null) {
    for (const a of this.assignments) if (a.jobId === jobId && a.status === 'active') Object.assign(a, { status, endedAt: new Date().toISOString(), endReason: reason })
  }
  async rpcDispatch(jobId: string, xpertId: string) {
    const j = this.need(jobId); this.expect(j, 'awaiting_dispatch')
    this.addAssignment(jobId, xpertId)
    Object.assign(j, { status: 'dispatched', xpertId, dispatchedAt: new Date().toISOString() })
  }
  async rpcStart(jobId: string) {
    const j = this.need(jobId); this.expect(j, 'dispatched')
    Object.assign(j, { status: 'in_progress', startedAt: new Date().toISOString() })
  }
  async rpcReplace(jobId: string, xpertId: string, reason: string) {
    const j = this.need(jobId); this.expect(j, 'dispatched', 'in_progress')
    if (j.xpertId === xpertId) throw new StoreError('conflict', 'That Xpert is already on the job.')
    this.endActive(jobId, 'replaced', reason)
    this.addAssignment(jobId, xpertId)
    Object.assign(j, { xpertId, xpertConfirmedAt: null })
  }
  async rpcConfirm(jobId: string, side: 'employer' | 'xpert') {
    const j = this.need(jobId); this.expect(j, 'in_progress')
    const now = new Date().toISOString()
    if (side === 'employer') j.employerConfirmedAt ??= now
    else j.xpertConfirmedAt ??= now
    const completed = !!(j.employerConfirmedAt && j.xpertConfirmedAt)
    if (completed) {
      Object.assign(j, { status: 'completed', completedAt: now })
      this.endActive(jobId, 'completed', null)
      const p = this.reqs.payments.find((x) => x.id === j.paymentId)
      if (p?.status === 'received') p.status = 'released'
    }
    return { completed }
  }
  async rpcCancel(jobId: string, reason: string) {
    const j = this.need(jobId); this.expect(j, 'awaiting_dispatch', 'dispatched', 'in_progress')
    this.endActive(jobId, 'withdrawn', reason)
    Object.assign(j, { status: 'cancelled', cancelledReason: reason })
  }

  async changeOrders(f: { status?: ChangeOrderStatus; jobId?: string }) { return this.changes.filter((c) => (!f.status || c.status === f.status) && (!f.jobId || c.jobId === f.jobId)) }
  async changeOrderById(id: string) { return this.changes.find((c) => c.id === id) ?? null }
  async createChangeOrder(i: any, actorId: string) {
    void actorId
    const j = this.need(i.jobId)
    const c: ChangeOrderRecord = { id: randomUUID(), jobId: i.jobId, jobLabel: `${j.category}, ${j.location}`, description: i.description, amountDeltaGhs: i.amountDeltaGhs ?? 0, status: 'logged', employerConfirmedAt: null, xpertConfirmedAt: null, rejectedBy: null, note: null, createdAt: new Date().toISOString(), loggedByName: null }
    this.changes.push(c)
    return c
  }
  private change(id: string) {
    const c = this.changes.find((x) => x.id === id)
    if (!c) throw new StoreError('not_found', 'Not found')
    if (c.status !== 'logged') throw new StoreError('conflict', `This change order is now ${c.status}.`)
    return c
  }
  async rpcConfirmChange(id: string, side: 'employer' | 'xpert') {
    const c = this.change(id)
    const now = new Date().toISOString()
    if (side === 'employer') c.employerConfirmedAt ??= now
    else c.xpertConfirmedAt ??= now
    if (c.employerConfirmedAt && c.xpertConfirmedAt) c.status = 'confirmed'
  }
  async rpcRejectChange(id: string, side: 'employer' | 'xpert', note: string) {
    Object.assign(this.change(id), { status: 'rejected', rejectedBy: side, note })
  }
  async cancelChange(id: string) { this.change(id).status = 'cancelled' }

  async recurring() { return this.recurringRows.map((r) => ({ ...r, due: r.active && r.nextDue <= new Date().toISOString().slice(0, 10) })) }
  async createRecurring(i: any) {
    const r: RecurringRecord = { id: randomUUID(), employerName: i.employerName, employerPhone: i.employerPhone, category: i.category, description: i.description, location: i.location, timing: i.timing, frequency: i.frequency, nextDue: i.nextDue, active: true, lastGeneratedAt: null, due: false }
    this.recurringRows.push(r)
    return r
  }
  async setRecurringActive(id: string, active: boolean) {
    const r = this.recurringRows.find((x) => x.id === id)
    if (!r) throw new StoreError('not_found', 'Not found')
    r.active = active
  }
  async rpcGenerate(id: string, actorId: string | null) {
    const r = this.recurringRows.find((x) => x.id === id)
    if (!r) throw new StoreError('not_found', 'Not found')
    if (!r.active) throw new StoreError('conflict', 'This recurring service is paused.')
    if (r.nextDue > new Date().toISOString().slice(0, 10)) throw new StoreError('conflict', 'Nothing is due yet.')
    await this.reqs.createRequest({ employerName: r.employerName, employerPhone: r.employerPhone, category: r.category, description: r.description, location: r.location, timing: r.timing, photos: [] }, actorId ?? 'system')
    const d = new Date(r.nextDue + 'T00:00:00Z')
    if (r.frequency === 'monthly') d.setUTCMonth(d.getUTCMonth() + 1)
    else d.setUTCDate(d.getUTCDate() + (r.frequency === 'weekly' ? 7 : 14))
    r.nextDue = d.toISOString().slice(0, 10)
    r.lastGeneratedAt = new Date().toISOString()
  }

  async counts() {
    const n = (...s: JobStatus[]) => [...this.jobs.values()].filter((j) => s.includes(j.status)).length
    return { needsXpert: n('awaiting_dispatch'), live: n('dispatched', 'in_progress'), changeOrdersWaiting: this.changes.filter((c) => c.status === 'logged').length }
  }
  async staffNames() { return new Map<string, string>() }
}
