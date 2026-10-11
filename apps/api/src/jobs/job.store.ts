import { Injectable } from '@nestjs/common'
import type { AssignmentRecord, ChangeOrderInput, ChangeOrderRecord, ChangeOrderStatus, JobRecord, JobStatus, RecurringInput, RecurringRecord } from '@beyondx/shared'
import { SupabaseService } from '../supabase/supabase.service'
import { StoreError } from '../xperts/xpert.store'

export type JobFilter = { status?: JobStatus; q?: string; limit: number; offset: number }
export type JobRow = Omit<JobRecord, 'watch' | 'xpertName'>

export interface JobStore {
  listJobs(f: JobFilter): Promise<{ rows: JobRow[]; total: number }>
  getJob(id: string): Promise<JobRow | null>
  openJobs(): Promise<JobRow[]>
  assignmentsFor(jobId: string): Promise<AssignmentRecord[]>
  activeLoad(xpertIds: string[]): Promise<Map<string, number>>
  bandsFor(category: string): Promise<Map<string, { minGhs: number; maxGhs: number }>>
  paymentStatus(paymentId: string): Promise<string | null>

  rpcDispatch(jobId: string, xpertId: string, actorId: string): Promise<void>
  rpcStart(jobId: string, actorId: string): Promise<void>
  rpcReplace(jobId: string, xpertId: string, reason: string, actorId: string): Promise<void>
  rpcConfirm(jobId: string, side: 'employer' | 'xpert', actorId: string): Promise<{ completed: boolean }>
  rpcCancel(jobId: string, reason: string, actorId: string): Promise<void>

  changeOrders(f: { status?: ChangeOrderStatus; jobId?: string }): Promise<ChangeOrderRecord[]>
  createChangeOrder(i: ChangeOrderInput, actorId: string): Promise<ChangeOrderRecord>
  changeOrderById(id: string): Promise<ChangeOrderRecord | null>
  rpcConfirmChange(id: string, side: 'employer' | 'xpert', actorId: string): Promise<void>
  rpcRejectChange(id: string, side: 'employer' | 'xpert', note: string, actorId: string): Promise<void>
  cancelChange(id: string, actorId: string, reason: string): Promise<void>

  recurring(): Promise<RecurringRecord[]>
  createRecurring(i: RecurringInput, actorId: string): Promise<RecurringRecord>
  setRecurringActive(id: string, active: boolean, actorId: string, reason: string): Promise<void>
  rpcGenerate(id: string, actorId: string | null): Promise<void>

  counts(): Promise<{ needsXpert: number; live: number; changeOrdersWaiting: number }>
  staffNames(ids: (string | null)[]): Promise<Map<string, string>>
}
export const JOB_STORE = Symbol('JOB_STORE')

type Row = Record<string, any>
const fail = (what: string, error: { message: string } | null): never => {
  throw new StoreError('failed', `${what}: ${error?.message ?? 'unknown error'}`)
}
const rpcError = (what: string, e: { message: string; code?: string }): never => {
  if (e.code === '40001') throw new StoreError('conflict', e.message)
  if (e.code === 'P0002') throw new StoreError('not_found', 'Not found')
  return fail(what, e)
}

@Injectable()
export class SupabaseJobStore implements JobStore {
  constructor(private readonly supabase: SupabaseService) {}
  private get db() {
    return this.supabase.admin
  }

  private async toJobs(rows: Row[]): Promise<JobRow[]> {
    const ids = [...new Set(rows.map((r) => r.request_id))]
    const reqs = new Map<string, Row>()
    if (ids.length) {
      const { data, error } = await this.db.from('job_request').select('id,employer_name,employer_phone').in('id', ids)
      if (error) fail('Could not read requests', error)
      for (const r of (data ?? []) as Row[]) reqs.set(r.id, r)
    }
    return rows.map((r) => ({
      id: r.id, requestId: r.request_id, paymentId: r.payment_id, recurringId: r.recurring_id, category: r.category, location: r.location, timing: r.timing,
      amountGhs: Number(r.amount_ghs), status: r.status, xpertId: r.xpert_id,
      employerName: reqs.get(r.request_id)?.employer_name ?? '', employerPhone: reqs.get(r.request_id)?.employer_phone ?? '',
      dispatchedAt: r.dispatched_at, startedAt: r.started_at, employerConfirmedAt: r.employer_confirmed_at, xpertConfirmedAt: r.xpert_confirmed_at,
      completedAt: r.completed_at, cancelledReason: r.cancelled_reason, createdAt: r.created_at, coordinatorId: r.coordinator_id ?? null,
    }))
  }

  async listJobs(f: JobFilter) {
    let q = this.db.from('job').select('*', { count: 'exact' })
    if (f.status) q = q.eq('status', f.status)
    if (f.q) {
      const safe = f.q.replace(/[^\p{L}\p{N} +@.-]/gu, '')
      if (safe) q = q.or(['category', 'location'].map((c) => `${c}.ilike.%${safe}%`).join(','))
    }
    const { data, error, count } = await q.order('created_at', { ascending: false }).range(f.offset, f.offset + f.limit - 1)
    if (error) fail('Could not read jobs', error)
    return { rows: await this.toJobs((data ?? []) as Row[]), total: count ?? 0 }
  }
  async getJob(id: string) {
    const { data, error } = await this.db.from('job').select('*').eq('id', id).maybeSingle()
    if (error) fail('Could not read the job', error)
    return data ? (await this.toJobs([data as Row]))[0]! : null
  }
  async openJobs() {
    const { data, error } = await this.db.from('job').select('*').in('status', ['dispatched', 'in_progress']).limit(500)
    if (error) fail('Could not read jobs', error)
    return this.toJobs((data ?? []) as Row[])
  }
  async assignmentsFor(jobId: string) {
    const { data, error } = await this.db.from('assignment').select('*').eq('job_id', jobId).order('assigned_at', { ascending: false })
    if (error) fail('Could not read assignments', error)
    const rows = (data ?? []) as Row[]
    const names = await this.staffNames(rows.map((r) => r.assigned_by))
    return rows.map((r) => ({ id: r.id, jobId: r.job_id, xpertId: r.xpert_id, xpertName: null, status: r.status, assignedAt: r.assigned_at, endedAt: r.ended_at, endReason: r.end_reason, assignedByName: r.assigned_by ? (names.get(r.assigned_by) ?? null) : null }))
  }
  async activeLoad(xpertIds: string[]) {
    const out = new Map<string, number>()
    if (!xpertIds.length) return out
    const { data, error } = await this.db.from('assignment').select('xpert_id').eq('status', 'active').in('xpert_id', xpertIds)
    if (error) fail('Could not read workloads', error)
    for (const r of (data ?? []) as Row[]) out.set(r.xpert_id, (out.get(r.xpert_id) ?? 0) + 1)
    return out
  }
  async bandsFor(category: string) {
    const { data, error } = await this.db.from('price_band').select('xpert_id,min_ghs,max_ghs').eq('active', true).ilike('category', category.replace(/[%_]/g, ''))
    if (error) fail('Could not read price bands', error)
    return new Map(((data ?? []) as Row[]).map((r) => [r.xpert_id as string, { minGhs: Number(r.min_ghs), maxGhs: Number(r.max_ghs) }]))
  }
  async paymentStatus(paymentId: string) {
    const { data, error } = await this.db.from('payment').select('status').eq('id', paymentId).maybeSingle()
    if (error) fail('Could not read the payment', error)
    return (data as Row | null)?.status ?? null
  }

  async rpcDispatch(jobId: string, xpertId: string, actorId: string) {
    const { error } = await this.db.rpc('job_dispatch', { p_job_id: jobId, p_xpert_id: xpertId, p_actor: actorId })
    if (error) rpcError('Could not dispatch', error)
  }
  async rpcStart(jobId: string, actorId: string) {
    const { error } = await this.db.rpc('job_start', { p_job_id: jobId, p_actor: actorId })
    if (error) rpcError('Could not start the job', error)
  }
  async rpcReplace(jobId: string, xpertId: string, reason: string, actorId: string) {
    const { error } = await this.db.rpc('job_replace', { p_job_id: jobId, p_new_xpert: xpertId, p_reason: reason, p_actor: actorId })
    if (error) rpcError('Could not replace the Xpert', error)
  }
  async rpcConfirm(jobId: string, side: 'employer' | 'xpert', actorId: string) {
    const { data, error } = await this.db.rpc('job_confirm', { p_job_id: jobId, p_side: side, p_actor: actorId })
    if (error) rpcError('Could not record the confirmation', error)
    return { completed: !!(data as Row | null)?.completed }
  }
  async rpcCancel(jobId: string, reason: string, actorId: string) {
    const { error } = await this.db.rpc('job_cancel', { p_job_id: jobId, p_reason: reason, p_actor: actorId })
    if (error) rpcError('Could not cancel the job', error)
  }

  private async toChanges(rows: Row[]): Promise<ChangeOrderRecord[]> {
    const names = await this.staffNames(rows.map((r) => r.logged_by))
    const jobIds = [...new Set(rows.map((r) => r.job_id))]
    const labels = new Map<string, string>()
    if (jobIds.length) {
      const { data } = await this.db.from('job').select('id,category,location').in('id', jobIds)
      for (const j of (data ?? []) as Row[]) labels.set(j.id, `${j.category}, ${j.location}`)
    }
    return rows.map((r) => ({ id: r.id, jobId: r.job_id, jobLabel: labels.get(r.job_id) ?? null, description: r.description, amountDeltaGhs: Number(r.amount_delta_ghs), status: r.status, employerConfirmedAt: r.employer_confirmed_at, xpertConfirmedAt: r.xpert_confirmed_at, rejectedBy: r.rejected_by, note: r.note, createdAt: r.created_at, loggedByName: r.logged_by ? (names.get(r.logged_by) ?? null) : null }))
  }
  async changeOrders(f: { status?: ChangeOrderStatus; jobId?: string }) {
    let q = this.db.from('change_order').select('*')
    if (f.status) q = q.eq('status', f.status)
    if (f.jobId) q = q.eq('job_id', f.jobId)
    const { data, error } = await q.order('created_at', { ascending: false }).limit(200)
    if (error) fail('Could not read change orders', error)
    return this.toChanges((data ?? []) as Row[])
  }
  async changeOrderById(id: string) {
    const { data, error } = await this.db.from('change_order').select('*').eq('id', id).maybeSingle()
    if (error) fail('Could not read the change order', error)
    return data ? (await this.toChanges([data as Row]))[0]! : null
  }
  async createChangeOrder(i: ChangeOrderInput, actorId: string) {
    const { data, error } = await this.db.from('change_order').insert({ job_id: i.jobId, description: i.description, amount_delta_ghs: i.amountDeltaGhs, logged_by: actorId, updated_by: actorId, change_reason: 'Logged' }).select('*').single()
    if (error) fail('Could not save the change order', error)
    return (await this.toChanges([data as Row]))[0]!
  }
  async rpcConfirmChange(id: string, side: 'employer' | 'xpert', actorId: string) {
    const { error } = await this.db.rpc('change_order_confirm', { p_id: id, p_side: side, p_actor: actorId })
    if (error) rpcError('Could not confirm', error)
  }
  async rpcRejectChange(id: string, side: 'employer' | 'xpert', note: string, actorId: string) {
    const { error } = await this.db.rpc('change_order_reject', { p_id: id, p_side: side, p_note: note, p_actor: actorId })
    if (error) rpcError('Could not reject', error)
  }
  async cancelChange(id: string, actorId: string, reason: string) {
    const { data, error } = await this.db.from('change_order').update({ status: 'cancelled', updated_by: actorId, change_reason: reason }).eq('id', id).eq('status', 'logged').select('id')
    if (error) fail('Could not cancel', error)
    if (!data?.length) throw new StoreError('conflict', 'This change order is no longer waiting.')
  }

  private toRecurring = (r: Row): RecurringRecord => ({ id: r.id, employerName: r.employer_name, employerPhone: r.employer_phone, category: r.category, description: r.description, location: r.location, timing: r.timing, frequency: r.frequency, nextDue: r.next_due, active: r.active, lastGeneratedAt: r.last_generated_at, due: r.active && r.next_due <= new Date().toISOString().slice(0, 10) })
  async recurring() {
    const { data, error } = await this.db.from('recurring_service').select('*').order('next_due')
    if (error) fail('Could not read recurring services', error)
    return ((data ?? []) as Row[]).map(this.toRecurring)
  }
  async createRecurring(i: RecurringInput, actorId: string) {
    const { data, error } = await this.db.from('recurring_service').insert({ employer_id: i.employerId ?? null, employer_name: i.employerName, employer_phone: i.employerPhone, category: i.category, description: i.description, location: i.location, timing: i.timing, frequency: i.frequency, next_due: i.nextDue, updated_by: actorId, change_reason: 'Created' }).select('*').single()
    if (error) fail('Could not save', error)
    return this.toRecurring(data as Row)
  }
  async setRecurringActive(id: string, active: boolean, actorId: string, reason: string) {
    const { data, error } = await this.db.from('recurring_service').update({ active, updated_by: actorId, change_reason: reason }).eq('id', id).select('id')
    if (error) fail('Could not update', error)
    if (!data?.length) throw new StoreError('not_found', 'Not found')
  }
  async rpcGenerate(id: string, actorId: string | null) {
    const { error } = await this.db.rpc('recurring_generate', { p_id: id, p_actor: actorId })
    if (error) rpcError('Could not generate the request', error)
  }

  async counts() {
    const head = { count: 'exact' as const, head: true }
    const [a, b, c] = await Promise.all([
      this.db.from('job').select('id', head).eq('status', 'awaiting_dispatch'),
      this.db.from('job').select('id', head).in('status', ['dispatched', 'in_progress']),
      this.db.from('change_order').select('id', head).eq('status', 'logged'),
    ])
    for (const x of [a, b, c]) if (x.error) fail('Could not count jobs', x.error)
    return { needsXpert: a.count ?? 0, live: b.count ?? 0, changeOrdersWaiting: c.count ?? 0 }
  }
  async staffNames(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((i): i is string => !!i))]
    const out = new Map<string, string>()
    if (!unique.length) return out
    const { data, error } = await this.db.from('staff_profile').select('user_id,full_name').in('user_id', unique)
    if (error) fail('Could not read staff names', error)
    for (const r of (data ?? []) as Row[]) out.set(r.user_id, r.full_name)
    return out
  }
}
