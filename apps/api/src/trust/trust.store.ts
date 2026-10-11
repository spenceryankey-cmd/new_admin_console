import { Injectable } from '@nestjs/common'
import type {
  CoordinatorInput,
  CoordinatorRecord,
  CounterFlagInput,
  FeedbackInput,
  FeedbackRecord,
  FlagListQuery,
  FlagRecord,
  RaiseFlagInput,
  ReliabilityRecord,
  TrustCounts,
} from '@beyondx/shared'
import { SupabaseService } from '../supabase/supabase.service'
import { StoreError } from '../xperts/xpert.store'

export type JobInfo = { id: string; xpertId: string | null; status: string; category: string; location: string; coordinatorId: string | null }
export type CoordinatorJobStats = { live: number; completed: number }

export interface TrustStore {
  listFlags(f: FlagListQuery): Promise<{ rows: FlagRecord[]; total: number }>
  flagById(id: string): Promise<FlagRecord | null>
  countersFor(flagId: string): Promise<FlagRecord[]>
  createFlag(i: RaiseFlagInput, actorId: string): Promise<FlagRecord>
  createCounter(parent: FlagRecord, i: CounterFlagInput, actorId: string): Promise<FlagRecord>
  rpcInvestigate(id: string, actorId: string): Promise<void>
  rpcDecide(id: string, outcome: 'upheld' | 'dismissed', note: string, actorId: string): Promise<void>

  jobInfo(jobId: string): Promise<JobInfo | null>
  feedbackList(f: { limit: number; offset: number; xpertId?: string }): Promise<{ rows: FeedbackRecord[]; total: number }>
  createFeedback(i: FeedbackInput, actorId: string): Promise<FeedbackRecord>

  reliability(xpertIds: string[]): Promise<Map<string, ReliabilityRecord>>

  coordinators(): Promise<CoordinatorRecord[]>
  coordinatorById(id: string): Promise<CoordinatorRecord | null>
  createCoordinator(i: CoordinatorInput, actorId: string): Promise<CoordinatorRecord>
  setCoordinatorActive(id: string, active: boolean, actorId: string, reason: string): Promise<void>
  roster(coordinatorId: string): Promise<string[]>
  assignXpert(coordinatorId: string, xpertId: string, actorId: string, reason: string): Promise<void>
  coordinatorJobStats(coordinatorId: string): Promise<CoordinatorJobStats>

  counts(): Promise<TrustCounts>
  staffNames(ids: (string | null)[]): Promise<Map<string, string>>
}
export const TRUST_STORE = Symbol('TRUST_STORE')

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
export class SupabaseTrustStore implements TrustStore {
  constructor(private readonly supabase: SupabaseService) {}
  private get db() {
    return this.supabase.admin
  }

  private async toFlags(rows: Row[]): Promise<FlagRecord[]> {
    const names = await this.staffNames(rows.flatMap((r) => [r.raised_by, r.decided_by]))
    return rows.map((r) => ({
      id: r.id, xpertId: r.xpert_id, xpertName: null, jobId: r.job_id, kind: r.kind, parentFlagId: r.parent_flag_id, raisedBy: r.raised_by_type,
      raisedByStaffName: r.raised_by ? (names.get(r.raised_by) ?? null) : null, category: r.category, detail: r.detail, status: r.status,
      decidedByName: r.decided_by ? (names.get(r.decided_by) ?? null) : null, decidedAt: r.decided_at, decisionNote: r.decision_note, createdAt: r.created_at,
    }))
  }
  async listFlags(f: FlagListQuery) {
    let q = this.db.from('flag').select('*', { count: 'exact' }).eq('kind', 'flag')
    if (f.status) q = q.eq('status', f.status)
    if (f.xpertId) q = q.eq('xpert_id', f.xpertId)
    const { data, error, count } = await q.order('created_at', { ascending: false }).range(f.offset, f.offset + f.limit - 1)
    if (error) fail('Could not read flags', error)
    return { rows: await this.toFlags((data ?? []) as Row[]), total: count ?? 0 }
  }
  async flagById(id: string) {
    const { data, error } = await this.db.from('flag').select('*').eq('id', id).maybeSingle()
    if (error) fail('Could not read the flag', error)
    return data ? (await this.toFlags([data as Row]))[0]! : null
  }
  async countersFor(flagId: string) {
    const { data, error } = await this.db.from('flag').select('*').eq('parent_flag_id', flagId).order('created_at')
    if (error) fail('Could not read counter flags', error)
    return this.toFlags((data ?? []) as Row[])
  }
  async createFlag(i: RaiseFlagInput, actorId: string) {
    const { data, error } = await this.db.from('flag').insert({ xpert_id: i.xpertId, job_id: i.jobId ?? null, raised_by_type: i.raisedBy, raised_by: actorId, category: i.category, detail: i.detail, updated_by: actorId, change_reason: 'Raised' }).select('*').single()
    if (error) fail('Could not save the flag', error)
    return (await this.toFlags([data as Row]))[0]!
  }
  async createCounter(parent: FlagRecord, i: CounterFlagInput, actorId: string) {
    const { data, error } = await this.db.from('flag').insert({ xpert_id: parent.xpertId, job_id: parent.jobId, kind: 'counter_flag', parent_flag_id: parent.id, raised_by_type: i.raisedBy, raised_by: actorId, category: parent.category, detail: i.detail, updated_by: actorId, change_reason: 'Counter flag' }).select('*').single()
    if (error) fail('Could not save the counter flag', error)
    return (await this.toFlags([data as Row]))[0]!
  }
  async rpcInvestigate(id: string, actorId: string) {
    const { error } = await this.db.rpc('flag_investigate', { p_id: id, p_actor: actorId })
    if (error) rpcError('Could not start the investigation', error)
  }
  async rpcDecide(id: string, outcome: 'upheld' | 'dismissed', note: string, actorId: string) {
    const { error } = await this.db.rpc('flag_decide', { p_id: id, p_outcome: outcome, p_note: note, p_actor: actorId })
    if (error) rpcError('Could not record the decision', error)
  }

  async jobInfo(jobId: string) {
    const { data, error } = await this.db.from('job').select('id,xpert_id,status,category,location,coordinator_id').eq('id', jobId).maybeSingle()
    if (error) fail('Could not read the job', error)
    const r = data as Row | null
    return r ? { id: r.id, xpertId: r.xpert_id, status: r.status, category: r.category, location: r.location, coordinatorId: r.coordinator_id } : null
  }

  private async toFeedback(rows: Row[]): Promise<FeedbackRecord[]> {
    const names = await this.staffNames(rows.map((r) => r.logged_by))
    const ids = [...new Set(rows.map((r) => r.job_id))]
    const jobs = new Map<string, Row>()
    if (ids.length) {
      const { data } = await this.db.from('job').select('id,category,location,xpert_id').in('id', ids)
      for (const j of (data ?? []) as Row[]) jobs.set(j.id, j)
    }
    return rows.map((r) => ({ id: r.id, jobId: r.job_id, jobLabel: jobs.get(r.job_id) ? `${jobs.get(r.job_id)!.category}, ${jobs.get(r.job_id)!.location}` : null, xpertId: jobs.get(r.job_id)?.xpert_id ?? null, xpertName: null, side: r.side, rating: r.rating, onTime: r.on_time, wouldRepeat: r.would_repeat, comment: r.comment, createdAt: r.created_at, loggedByName: r.logged_by ? (names.get(r.logged_by) ?? null) : null }))
  }
  async feedbackList(f: { limit: number; offset: number; xpertId?: string }) {
    let jobIds: string[] | null = null
    if (f.xpertId) {
      const { data, error } = await this.db.from('job').select('id').eq('xpert_id', f.xpertId)
      if (error) fail('Could not read jobs', error)
      jobIds = ((data ?? []) as Row[]).map((r) => r.id)
      if (!jobIds.length) return { rows: [], total: 0 }
    }
    let q = this.db.from('feedback').select('*', { count: 'exact' })
    if (jobIds) q = q.in('job_id', jobIds)
    const { data, error, count } = await q.order('created_at', { ascending: false }).range(f.offset, f.offset + f.limit - 1)
    if (error) fail('Could not read feedback', error)
    return { rows: await this.toFeedback((data ?? []) as Row[]), total: count ?? 0 }
  }
  async createFeedback(i: FeedbackInput, actorId: string) {
    const { data, error } = await this.db.from('feedback').insert({ job_id: i.jobId, side: i.side, rating: i.rating, on_time: i.onTime, would_repeat: i.wouldRepeat, comment: i.comment ?? null, logged_by: actorId, updated_by: actorId, change_reason: 'Logged' }).select('*').single()
    if (error) {
      if (error.code === '23505') throw new StoreError('conflict', 'Feedback from that side has already been logged for this job.')
      fail('Could not save the feedback', error)
    }
    return (await this.toFeedback([data as Row]))[0]!
  }

  async reliability(xpertIds: string[]) {
    const out = new Map<string, ReliabilityRecord>()
    if (!xpertIds.length) return out
    const { data, error } = await this.db.from('xpert_reliability').select('*').in('xpert_id', xpertIds)
    if (error) fail('Could not read reliability records', error)
    for (const r of (data ?? []) as Row[]) {
      out.set(r.xpert_id, { xpertId: r.xpert_id, jobsCompleted: Number(r.jobs_completed), cleanJobs: Number(r.clean_jobs), avgRating: r.avg_rating === null ? null : Number(r.avg_rating), onTimeRate: r.on_time_rate === null ? null : Number(r.on_time_rate), timesReplaced: Number(r.times_replaced), jobsWithdrawn: Number(r.jobs_withdrawn), flagsUpheld: Number(r.flags_upheld), flagsOpen: Number(r.flags_open) })
    }
    return out
  }

  private toCoordinator = (r: Row): CoordinatorRecord => ({ id: r.id, fullName: r.full_name, phone: r.phone, area: r.area, active: r.active, note: r.note, createdAt: r.created_at })
  async coordinators() {
    const { data, error } = await this.db.from('coordinator').select('*').order('full_name')
    if (error) fail('Could not read coordinators', error)
    return ((data ?? []) as Row[]).map(this.toCoordinator)
  }
  async coordinatorById(id: string) {
    const { data, error } = await this.db.from('coordinator').select('*').eq('id', id).maybeSingle()
    if (error) fail('Could not read the coordinator', error)
    return data ? this.toCoordinator(data as Row) : null
  }
  async createCoordinator(i: CoordinatorInput, actorId: string) {
    const { data, error } = await this.db.from('coordinator').insert({ full_name: i.fullName, phone: i.phone ?? null, area: i.area ?? null, note: i.note ?? null, updated_by: actorId, change_reason: 'Added' }).select('*').single()
    if (error) fail('Could not save the coordinator', error)
    return this.toCoordinator(data as Row)
  }
  async setCoordinatorActive(id: string, active: boolean, actorId: string, reason: string) {
    const { data, error } = await this.db.from('coordinator').update({ active, updated_by: actorId, change_reason: reason }).eq('id', id).select('id')
    if (error) fail('Could not update', error)
    if (!data?.length) throw new StoreError('not_found', 'Not found')
  }
  async roster(coordinatorId: string) {
    const { data, error } = await this.db.from('coordinator_xpert').select('xpert_id').eq('coordinator_id', coordinatorId).eq('active', true)
    if (error) fail('Could not read the roster', error)
    return ((data ?? []) as Row[]).map((r) => r.xpert_id as string)
  }
  async assignXpert(coordinatorId: string, xpertId: string, actorId: string, reason: string) {
    // The Xpert moves from any current coordinator to this one. The old row stays, marked inactive.
    const { error: e1 } = await this.db.from('coordinator_xpert').update({ active: false, updated_by: actorId, change_reason: `Moved: ${reason}` }).eq('xpert_id', xpertId).eq('active', true)
    if (e1) fail('Could not end the old assignment', e1)
    const { error } = await this.db.from('coordinator_xpert').insert({ coordinator_id: coordinatorId, xpert_id: xpertId, updated_by: actorId, change_reason: reason })
    if (error) fail('Could not assign the Xpert', error)
  }
  async coordinatorJobStats(coordinatorId: string) {
    const head = { count: 'exact' as const, head: true }
    const [a, b] = await Promise.all([
      this.db.from('job').select('id', head).eq('coordinator_id', coordinatorId).in('status', ['dispatched', 'in_progress']),
      this.db.from('job').select('id', head).eq('coordinator_id', coordinatorId).eq('status', 'completed'),
    ])
    for (const x of [a, b]) if (x.error) fail('Could not count jobs', x.error)
    return { live: a.count ?? 0, completed: b.count ?? 0 }
  }

  async counts() {
    const head = { count: 'exact' as const, head: true }
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()
    const [a, b] = await Promise.all([
      this.db.from('flag').select('id', head).eq('kind', 'flag').in('status', ['open', 'investigating']),
      this.db.from('feedback').select('id', head).gte('created_at', weekAgo),
    ])
    for (const x of [a, b]) if (x.error) fail('Could not count', x.error)
    return { flagsOpen: a.count ?? 0, feedbackThisWeek: b.count ?? 0 }
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
