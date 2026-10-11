import { Injectable } from '@nestjs/common'
import type {
  BandInput,
  BenchmarkInput,
  BenchmarkRate,
  CreateRequestInput,
  PaymentRecord,
  PriceBand,
  QuoteLine,
  QuoteRecord,
  RequestCounts,
  RequestRecord,
  RequestStatus,
} from '@beyondx/shared'
import { SupabaseService } from '../supabase/supabase.service'
import { StoreError } from '../xperts/xpert.store'

export type RequestFilter = { status?: RequestStatus; q?: string; limit: number; offset: number }
export type DraftInput = { requestId: string; version: number; totalGhs: number; lines: QuoteLine[]; notes: string | null; actorId: string }

export interface RequestStore {
  listRequests(f: RequestFilter): Promise<{ rows: RequestRecord[]; total: number }>
  getRequest(id: string): Promise<RequestRecord | null>
  createRequest(i: CreateRequestInput, actorId: string): Promise<RequestRecord>
  setRequestStatus(id: string, from: RequestStatus, to: RequestStatus, actorId: string | null, reason: string): Promise<void>

  quotesFor(requestId: string): Promise<QuoteRecord[]>
  quoteById(id: string): Promise<QuoteRecord | null>
  createDraft(d: DraftInput): Promise<QuoteRecord>
  updateDraft(id: string, d: { totalGhs: number; lines: QuoteLine[]; notes: string | null }, actorId: string): Promise<QuoteRecord>
  rpcSend(quoteId: string, validDays: number, actorId: string | null): Promise<void>
  rpcWithdraw(quoteId: string, reason: string, actorId: string): Promise<void>
  rpcRespond(quoteId: string, expected: 'sent', response: 'accepted' | 'declined' | 'expired', source: 'employer' | 'staff_logged', note: string | null, actorId: string | null): Promise<void>
  sentQuotesDueBy(now: Date): Promise<QuoteRecord[]>

  paymentFor(requestId: string): Promise<PaymentRecord | null>
  markReceived(paymentId: string, reference: string, actorId: string): Promise<PaymentRecord>

  benchmarks(): Promise<BenchmarkRate[]>
  saveBenchmark(i: BenchmarkInput, actorId: string): Promise<BenchmarkRate>
  patchBenchmark(id: string, p: { amountGhs?: number; active?: boolean }, actorId: string, reason: string): Promise<BenchmarkRate>
  bands(xpertId?: string): Promise<PriceBand[]>
  saveBand(i: BandInput, actorId: string): Promise<PriceBand>
  patchBand(id: string, p: { minGhs?: number; maxGhs?: number; active?: boolean }, actorId: string, reason: string): Promise<PriceBand>

  counts(): Promise<RequestCounts>
  staffNames(ids: (string | null)[]): Promise<Map<string, string>>
  xpertNames(ids: string[]): Promise<Map<string, string>>
}
export const REQUEST_STORE = Symbol('REQUEST_STORE')

type Row = Record<string, any>
const fail = (what: string, error: { message: string; code?: string } | null): never => {
  throw new StoreError('failed', `${what}: ${error?.message ?? 'unknown error'}`)
}
const rpcError = (what: string, e: { message: string; code?: string }): never => {
  if (e.code === '40001') throw new StoreError('conflict', e.message)
  if (e.code === 'P0002') throw new StoreError('not_found', 'Not found')
  return fail(what, e)
}

@Injectable()
export class SupabaseRequestStore implements RequestStore {
  constructor(private readonly supabase: SupabaseService) {}
  private get db() {
    return this.supabase.admin
  }

  private toRequest(r: Row, quoted: number | null = null): RequestRecord {
    return {
      id: r.id,
      employerId: r.employer_id,
      employerName: r.employer_name,
      employerPhone: r.employer_phone,
      category: r.category,
      description: r.description,
      location: r.location,
      timing: r.timing,
      specialRequirements: r.special_requirements,
      photos: Array.isArray(r.photos) ? r.photos : [],
      status: r.status,
      sourceTaskId: r.source_task_id,
      createdAt: r.created_at,
      quotedGhs: quoted,
    }
  }

  private async withQuoted(rows: Row[]): Promise<RequestRecord[]> {
    const ids = rows.map((r) => r.id)
    const live = new Map<string, number>()
    if (ids.length) {
      const { data, error } = await this.db.from('quote').select('request_id,total_ghs,status').in('request_id', ids).in('status', ['sent', 'accepted'])
      if (error) fail('Could not read quotes', error)
      for (const q of (data ?? []) as Row[]) live.set(q.request_id, Number(q.total_ghs))
    }
    return rows.map((r) => this.toRequest(r, live.get(r.id) ?? null))
  }

  async listRequests(f: RequestFilter) {
    let q = this.db.from('job_request').select('*', { count: 'exact' })
    if (f.status) q = q.eq('status', f.status)
    if (f.q) {
      const safe = f.q.replace(/[^\p{L}\p{N} +@.-]/gu, '')
      if (safe) q = q.or(['employer_name', 'employer_phone', 'category'].map((c) => `${c}.ilike.%${safe}%`).join(','))
    }
    const { data, error, count } = await q.order('created_at', { ascending: false }).range(f.offset, f.offset + f.limit - 1)
    if (error) fail('Could not read requests', error)
    return { rows: await this.withQuoted((data ?? []) as Row[]), total: count ?? 0 }
  }

  async getRequest(id: string) {
    const { data, error } = await this.db.from('job_request').select('*').eq('id', id).maybeSingle()
    if (error) fail('Could not read the request', error)
    return data ? (await this.withQuoted([data as Row]))[0]! : null
  }

  async createRequest(i: CreateRequestInput, actorId: string) {
    const { data, error } = await this.db
      .from('job_request')
      .insert({
        employer_id: i.employerId ?? null,
        employer_name: i.employerName,
        employer_phone: i.employerPhone,
        category: i.category,
        description: i.description,
        location: i.location,
        timing: i.timing,
        special_requirements: i.specialRequirements || null,
        photos: i.photos,
        updated_by: actorId,
        change_reason: 'Entered by staff',
      })
      .select('*')
      .single()
    if (error) fail('Could not save the request', error)
    return this.toRequest(data as Row)
  }

  async setRequestStatus(id: string, from: RequestStatus, to: RequestStatus, actorId: string | null, reason: string) {
    const { data, error } = await this.db.from('job_request').update({ status: to, updated_by: actorId, change_reason: reason }).eq('id', id).eq('status', from).select('id')
    if (error) fail('Could not update the request', error)
    if (!data || data.length === 0) throw new StoreError('conflict', 'The request changed. Reload and try again.')
  }

  private async toQuotes(rows: Row[]): Promise<QuoteRecord[]> {
    const names = await this.staffNames(rows.map((r) => r.composed_by))
    return rows.map((r) => ({
      id: r.id,
      requestId: r.request_id,
      version: r.version,
      status: r.status,
      totalGhs: Number(r.total_ghs),
      lines: Array.isArray(r.lines) ? r.lines : [],
      notes: r.notes,
      composedBy: r.composed_by,
      composedByName: r.composed_by ? (names.get(r.composed_by) ?? null) : null,
      sentAt: r.sent_at,
      validUntil: r.valid_until,
      respondedAt: r.responded_at,
      responseSource: r.response_source,
      responseNote: r.response_note,
      createdAt: r.created_at,
    }))
  }

  async quotesFor(requestId: string) {
    const { data, error } = await this.db.from('quote').select('*').eq('request_id', requestId).order('version', { ascending: false })
    if (error) fail('Could not read quotes', error)
    return this.toQuotes((data ?? []) as Row[])
  }

  async quoteById(id: string) {
    const { data, error } = await this.db.from('quote').select('*').eq('id', id).maybeSingle()
    if (error) fail('Could not read the quote', error)
    return data ? (await this.toQuotes([data as Row]))[0]! : null
  }

  async createDraft(d: DraftInput) {
    const { data, error } = await this.db
      .from('quote')
      .insert({ request_id: d.requestId, version: d.version, total_ghs: d.totalGhs, lines: d.lines, notes: d.notes, composed_by: d.actorId, updated_by: d.actorId, change_reason: 'Draft started' })
      .select('*')
      .single()
    if (error) fail('Could not save the quote', error)
    return (await this.toQuotes([data as Row]))[0]!
  }

  async updateDraft(id: string, d: { totalGhs: number; lines: QuoteLine[]; notes: string | null }, actorId: string) {
    const { data, error } = await this.db
      .from('quote')
      .update({ total_ghs: d.totalGhs, lines: d.lines, notes: d.notes, composed_by: actorId, updated_by: actorId, change_reason: 'Draft edited' })
      .eq('id', id)
      .eq('status', 'draft')
      .select('*')
      .maybeSingle()
    if (error) fail('Could not save the quote', error)
    if (!data) throw new StoreError('conflict', 'This quote is no longer a draft.')
    return (await this.toQuotes([data as Row]))[0]!
  }

  async rpcSend(quoteId: string, validDays: number, actorId: string | null) {
    const { error } = await this.db.rpc('quote_send', { p_quote_id: quoteId, p_valid_days: validDays, p_actor: actorId })
    if (error) rpcError('Could not send the quote', error)
  }
  async rpcWithdraw(quoteId: string, reason: string, actorId: string) {
    const { error } = await this.db.rpc('quote_withdraw', { p_quote_id: quoteId, p_reason: reason, p_actor: actorId })
    if (error) rpcError('Could not withdraw the quote', error)
  }
  async rpcRespond(quoteId: string, expected: 'sent', response: 'accepted' | 'declined' | 'expired', source: 'employer' | 'staff_logged', note: string | null, actorId: string | null) {
    const { error } = await this.db.rpc('quote_apply_response', { p_quote_id: quoteId, p_expected_status: expected, p_response: response, p_source: source, p_note: note, p_actor: actorId })
    if (error) rpcError('Could not record the response', error)
  }

  async sentQuotesDueBy(now: Date) {
    const { data, error } = await this.db.from('quote').select('*').eq('status', 'sent').lte('valid_until', now.toISOString()).limit(200)
    if (error) fail('Could not read quotes', error)
    return this.toQuotes((data ?? []) as Row[])
  }

  private toPayment(r: Row, names: Map<string, string>): PaymentRecord {
    return {
      id: r.id,
      requestId: r.request_id,
      quoteId: r.quote_id,
      amountGhs: Number(r.amount_ghs),
      method: r.method,
      status: r.status,
      momoReference: r.momo_reference,
      receivedAt: r.received_at,
      recordedByName: r.recorded_by ? (names.get(r.recorded_by) ?? null) : null,
    }
  }

  async paymentFor(requestId: string) {
    const { data, error } = await this.db.from('payment').select('*').eq('request_id', requestId).maybeSingle()
    if (error) fail('Could not read the payment', error)
    if (!data) return null
    return this.toPayment(data as Row, await this.staffNames([(data as Row).recorded_by]))
  }

  async markReceived(paymentId: string, reference: string, actorId: string) {
    const { data, error } = await this.db
      .from('payment')
      .update({ status: 'received', momo_reference: reference, received_at: new Date().toISOString(), recorded_by: actorId, updated_by: actorId, change_reason: 'Payment received' })
      .eq('id', paymentId)
      .eq('status', 'pending')
      .select('*')
      .maybeSingle()
    if (error) {
      if (error.code === '23505') throw new StoreError('conflict', 'That MoMo reference has already been recorded against another payment.')
      fail('Could not record the payment', error)
    }
    if (!data) throw new StoreError('conflict', 'This payment is no longer waiting.')
    return this.toPayment(data as Row, await this.staffNames([actorId]))
  }

  private toBenchmark = (r: Row): BenchmarkRate => ({ id: r.id, category: r.category, unit: r.unit, amountGhs: Number(r.amount_ghs), active: r.active, updatedAt: r.updated_at })

  async benchmarks() {
    const { data, error } = await this.db.from('benchmark_rate').select('*').order('category')
    if (error) fail('Could not read benchmark rates', error)
    return ((data ?? []) as Row[]).map(this.toBenchmark)
  }
  async saveBenchmark(i: BenchmarkInput, actorId: string) {
    // A new rate replaces the live one for the same category and unit. The old one stays, marked inactive.
    const { error: e1 } = await this.db.from('benchmark_rate').update({ active: false, updated_by: actorId, change_reason: `Replaced: ${i.reason}` }).ilike('category', i.category).eq('unit', i.unit).eq('active', true)
    if (e1) fail('Could not replace the old rate', e1)
    const { data, error } = await this.db.from('benchmark_rate').insert({ category: i.category, unit: i.unit, amount_ghs: i.amountGhs, updated_by: actorId, change_reason: i.reason }).select('*').single()
    if (error) fail('Could not save the rate', error)
    return this.toBenchmark(data as Row)
  }
  async patchBenchmark(id: string, p: { amountGhs?: number; active?: boolean }, actorId: string, reason: string) {
    const patch: Row = { updated_by: actorId, change_reason: reason }
    if (p.amountGhs !== undefined) patch.amount_ghs = p.amountGhs
    if (p.active !== undefined) patch.active = p.active
    const { data, error } = await this.db.from('benchmark_rate').update(patch).eq('id', id).select('*').maybeSingle()
    if (error) {
      if (error.code === '23505') throw new StoreError('conflict', 'There is already a live rate for that category and unit.')
      fail('Could not update the rate', error)
    }
    if (!data) throw new StoreError('not_found', 'Rate not found')
    return this.toBenchmark(data as Row)
  }

  private async toBands(rows: Row[]): Promise<PriceBand[]> {
    const names = await this.xpertNames([...new Set(rows.map((r) => r.xpert_id))])
    return rows.map((r) => ({ id: r.id, xpertId: r.xpert_id, xpertName: names.get(r.xpert_id) ?? null, category: r.category, minGhs: Number(r.min_ghs), maxGhs: Number(r.max_ghs), active: r.active, updatedAt: r.updated_at }))
  }
  async bands(xpertId?: string) {
    let q = this.db.from('price_band').select('*').order('category')
    if (xpertId) q = q.eq('xpert_id', xpertId)
    const { data, error } = await q
    if (error) fail('Could not read price bands', error)
    return this.toBands((data ?? []) as Row[])
  }
  async saveBand(i: BandInput, actorId: string) {
    const { error: e1 } = await this.db.from('price_band').update({ active: false, updated_by: actorId, change_reason: `Replaced: ${i.reason}` }).eq('xpert_id', i.xpertId).ilike('category', i.category).eq('active', true)
    if (e1) fail('Could not replace the old band', e1)
    const { data, error } = await this.db.from('price_band').insert({ xpert_id: i.xpertId, category: i.category, min_ghs: i.minGhs, max_ghs: i.maxGhs, updated_by: actorId, change_reason: i.reason }).select('*').single()
    if (error) fail('Could not save the band', error)
    return (await this.toBands([data as Row]))[0]!
  }
  async patchBand(id: string, p: { minGhs?: number; maxGhs?: number; active?: boolean }, actorId: string, reason: string) {
    const patch: Row = { updated_by: actorId, change_reason: reason }
    if (p.minGhs !== undefined) patch.min_ghs = p.minGhs
    if (p.maxGhs !== undefined) patch.max_ghs = p.maxGhs
    if (p.active !== undefined) patch.active = p.active
    const { data, error } = await this.db.from('price_band').update(patch).eq('id', id).select('*').maybeSingle()
    if (error) fail('Could not update the band', error)
    if (!data) throw new StoreError('not_found', 'Band not found')
    return (await this.toBands([data as Row]))[0]!
  }

  async counts() {
    const head = { count: 'exact' as const, head: true }
    const [n, a, p] = await Promise.all([
      this.db.from('job_request').select('id', head).eq('status', 'new'),
      this.db.from('job_request').select('id', head).eq('status', 'quoted'),
      this.db.from('payment').select('id', head).eq('status', 'pending'),
    ])
    for (const x of [n, a, p]) if (x.error) fail('Could not count requests', x.error)
    return { newRequests: n.count ?? 0, awaitingResponse: a.count ?? 0, awaitingPayment: p.count ?? 0 }
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

  async xpertNames(ids: string[]) {
    // The Xpert table is configured in the Xpert store. Names are filled in by the service when it can.
    void ids
    return new Map<string, string>()
  }
}
