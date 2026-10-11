import { randomUUID } from 'node:crypto'
import type { BenchmarkRate, PaymentRecord, PriceBand, QuoteRecord, RequestRecord, RequestStatus } from '@beyondx/shared'
import { StoreError } from '../xperts/xpert.store'
import type { RequestStore } from './request.store'

/** In memory stand in used by tests and the development mock. It mirrors the database functions' rules. */
export class FakeRequestStore implements RequestStore {
  requests = new Map<string, RequestRecord>()
  quotes: QuoteRecord[] = []
  payments: PaymentRecord[] = []
  rates: BenchmarkRate[] = []
  bandRows: PriceBand[] = []
  /** The database creates a job when a payment arrives. The fake job store listens here. */
  onReceived: ((p: PaymentRecord) => void) | null = null

  async listRequests(f: { status?: RequestStatus; q?: string; limit: number; offset: number }) {
    let rows = [...this.requests.values()]
    if (f.status) rows = rows.filter((r) => r.status === f.status)
    if (f.q) rows = rows.filter((r) => `${r.employerName} ${r.employerPhone} ${r.category}`.toLowerCase().includes(f.q!.toLowerCase()))
    rows = rows.map((r) => ({ ...r, quotedGhs: this.quotes.find((q) => q.requestId === r.id && (q.status === 'sent' || q.status === 'accepted'))?.totalGhs ?? null }))
    return { rows: rows.slice(f.offset, f.offset + f.limit), total: rows.length }
  }
  async getRequest(id: string) { return this.requests.get(id) ?? null }
  async createRequest(i: any, actorId: string) {
    void actorId
    const r: RequestRecord = { id: randomUUID(), employerId: i.employerId ?? null, employerName: i.employerName, employerPhone: i.employerPhone, category: i.category, description: i.description, location: i.location, timing: i.timing, specialRequirements: i.specialRequirements ?? null, photos: i.photos ?? [], status: 'new', sourceTaskId: null, createdAt: new Date().toISOString(), quotedGhs: null }
    this.requests.set(r.id, r)
    return r
  }
  async setRequestStatus(id: string, from: RequestStatus, to: RequestStatus) {
    const r = this.requests.get(id)
    if (!r || r.status !== from) throw new StoreError('conflict', 'The request changed.')
    r.status = to
  }

  async quotesFor(requestId: string) { return this.quotes.filter((q) => q.requestId === requestId).sort((a, b) => b.version - a.version) }
  async quoteById(id: string) { return this.quotes.find((q) => q.id === id) ?? null }
  async createDraft(d: any) {
    if (this.quotes.some((q) => q.requestId === d.requestId && (q.status === 'draft' || q.status === 'sent'))) throw new StoreError('conflict', 'There is already an open quote.')
    const q: QuoteRecord = { id: randomUUID(), requestId: d.requestId, version: d.version, status: 'draft', totalGhs: d.totalGhs, lines: d.lines, notes: d.notes, composedBy: d.actorId, composedByName: null, sentAt: null, validUntil: null, respondedAt: null, responseSource: null, responseNote: null, createdAt: new Date().toISOString() }
    this.quotes.push(q)
    return q
  }
  async updateDraft(id: string, d: any) {
    const q = this.quotes.find((x) => x.id === id)
    if (!q || q.status !== 'draft') throw new StoreError('conflict', 'This quote is no longer a draft.')
    Object.assign(q, { totalGhs: d.totalGhs, lines: d.lines, notes: d.notes })
    return q
  }
  async rpcSend(quoteId: string, days: number, actorId?: string | null) {
    void actorId
    const q = this.quotes.find((x) => x.id === quoteId)!
    const r = this.requests.get(q.requestId)!
    if (q.status !== 'draft' || r.status !== 'new') throw new StoreError('conflict', 'Cannot send.')
    q.status = 'sent'; q.sentAt = new Date().toISOString(); q.validUntil = new Date(Date.now() + days * 86_400_000).toISOString(); r.status = 'quoted'
  }
  async rpcWithdraw(quoteId: string, reason: string) {
    const q = this.quotes.find((x) => x.id === quoteId)!
    if (q.status !== 'draft' && q.status !== 'sent') throw new StoreError('conflict', 'Already closed.')
    const wasSent = q.status === 'sent'
    q.status = 'withdrawn'; q.responseNote = reason
    const r = this.requests.get(q.requestId)!
    if (wasSent && r.status === 'quoted') r.status = 'new'
  }
  async rpcRespond(quoteId: string, expected: 'sent', response: 'accepted' | 'declined' | 'expired', source: 'employer' | 'staff_logged', note: string | null) {
    const q = this.quotes.find((x) => x.id === quoteId)!
    const r = this.requests.get(q.requestId)!
    if (q.status !== expected || r.status !== 'quoted') throw new StoreError('conflict', 'Changed.')
    q.status = response; q.respondedAt = new Date().toISOString(); q.responseSource = response === 'expired' ? null : source; q.responseNote = note
    r.status = response
    if (response === 'accepted') this.payments.push({ id: randomUUID(), requestId: r.id, quoteId: q.id, amountGhs: q.totalGhs, method: 'momo', status: 'pending', momoReference: null, receivedAt: null, recordedByName: null })
  }
  async sentQuotesDueBy(now: Date) { return this.quotes.filter((q) => q.status === 'sent' && q.validUntil && new Date(q.validUntil) <= now) }

  async paymentFor(requestId: string) { return this.payments.find((p) => p.requestId === requestId) ?? null }
  async markReceived(paymentId: string, reference: string) {
    const p = this.payments.find((x) => x.id === paymentId)
    if (!p || p.status !== 'pending') throw new StoreError('conflict', 'This payment is no longer waiting.')
    if (this.payments.some((x) => x.momoReference?.toLowerCase() === reference.toLowerCase())) throw new StoreError('conflict', 'That MoMo reference has already been recorded against another payment.')
    Object.assign(p, { status: 'received', momoReference: reference, receivedAt: new Date().toISOString() })
    this.onReceived?.(p)
    return p
  }

  async benchmarks() { return this.rates }
  async saveBenchmark(i: any) {
    for (const r of this.rates) if (r.active && r.category.toLowerCase() === i.category.toLowerCase() && r.unit === i.unit) r.active = false
    const r: BenchmarkRate = { id: randomUUID(), category: i.category, unit: i.unit, amountGhs: i.amountGhs, active: true, updatedAt: new Date().toISOString() }
    this.rates.push(r)
    return r
  }
  async patchBenchmark(id: string, p: any) {
    const r = this.rates.find((x) => x.id === id)
    if (!r) throw new StoreError('not_found', 'Rate not found')
    Object.assign(r, p)
    return r
  }
  async bands(xpertId?: string) { return this.bandRows.filter((b) => !xpertId || b.xpertId === xpertId) }
  async saveBand(i: any) {
    for (const b of this.bandRows) if (b.active && b.xpertId === i.xpertId && b.category.toLowerCase() === i.category.toLowerCase()) b.active = false
    const b: PriceBand = { id: randomUUID(), xpertId: i.xpertId, xpertName: null, category: i.category, minGhs: i.minGhs, maxGhs: i.maxGhs, active: true, updatedAt: new Date().toISOString() }
    this.bandRows.push(b)
    return b
  }
  async patchBand(id: string, p: any) {
    const b = this.bandRows.find((x) => x.id === id)
    if (!b) throw new StoreError('not_found', 'Band not found')
    Object.assign(b, p)
    return b
  }

  async counts() {
    const n = (s: RequestStatus) => [...this.requests.values()].filter((r) => r.status === s).length
    return { newRequests: n('new'), awaitingResponse: n('quoted'), awaitingPayment: this.payments.filter((p) => p.status === 'pending').length }
  }
  async staffNames() { return new Map<string, string>() }
  async xpertNames() { return new Map<string, string>() }
}
