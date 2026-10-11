import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import {
  quoteProblems,
  requestMove,
  type BandInput,
  type BenchmarkInput,
  type ComposeQuoteInput,
  type CreateRequestInput,
  type PaymentRecord,
  type PaymentReceivedInput,
  type QuoteRecord,
  type QuoteResponseInput,
  type RequestDetail,
  type RequestListQuery,
  type RequestRecord,
} from '@beyondx/shared'
import type { StaffContext } from '../auth/staff-context'
import { ConfigService } from '../xperts/config.service'
import { StoreError, XPERT_STORE, type XpertStore } from '../xperts/xpert.store'
import { REQUEST_STORE, type RequestStore } from './request.store'

/** Turn a store failure into the right HTTP error. */
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
export class RequestsService {
  constructor(
    @Inject(REQUEST_STORE) private readonly store: RequestStore,
    @Inject(XPERT_STORE) private readonly xperts: XpertStore,
    private readonly config: ConfigService,
  ) {}

  async list(q: RequestListQuery) {
    const { rows, total } = await this.store.listRequests(q)
    return { requests: rows, total }
  }

  counts() {
    return this.store.counts()
  }

  async mustGet(id: string): Promise<RequestRecord> {
    const r = await this.store.getRequest(id)
    if (!r) throw new NotFoundException('That request was not found.')
    return r
  }

  async detail(id: string): Promise<RequestDetail> {
    const [request, quotes, payment, benchmarks, validityDays] = await Promise.all([
      this.mustGet(id),
      this.store.quotesFor(id),
      this.store.paymentFor(id),
      this.store.benchmarks(),
      this.config.quoteValidityDays(),
    ])
    const open = quotes.find((q) => q.status === 'draft' || q.status === 'sent')
    return {
      request,
      quotes,
      payment,
      benchmarks: benchmarks.filter((b) => b.active),
      validityDays,
      canSend: request.status === 'new' && open?.status === 'draft',
    }
  }

  async create(actor: StaffContext, input: CreateRequestInput) {
    return this.store.createRequest(input, actor.userId)
  }

  async cancel(actor: StaffContext, id: string, reason: string) {
    const r = await this.mustGet(id)
    const move = requestMove(r.status, 'cancelled')
    if (!move) throw new UnprocessableEntityException(`A request that is ${r.status} cannot be cancelled here.`)
    await guard(async () => {
      const quotes = await this.store.quotesFor(id)
      const open = quotes.find((q) => q.status === 'draft' || q.status === 'sent')
      if (open) await this.store.rpcWithdraw(open.id, `Request cancelled: ${reason}`, actor.userId)
      // Withdrawing a sent quote returns the request to New, so cancel from whatever it is now.
      const now = await this.mustGet(id)
      await this.store.setRequestStatus(id, now.status, 'cancelled', actor.userId, reason)
    })
    return this.detail(id)
  }

  // Quotes ------------------------------------------------------------------------------------
  async compose(actor: StaffContext, id: string, input: ComposeQuoteInput): Promise<QuoteRecord> {
    const r = await this.mustGet(id)
    if (r.status !== 'new') throw new ConflictException('A quote can only be prepared while the request is New. Withdraw the sent quote first.')
    const problems = quoteProblems(input.lines, input.totalGhs)
    if (problems.length) throw new UnprocessableEntityException(problems.join(' '))
    return guard(async () => {
      const quotes = await this.store.quotesFor(id)
      const draft = quotes.find((q) => q.status === 'draft')
      const data = { totalGhs: input.totalGhs, lines: input.lines, notes: input.notes?.trim() || null }
      if (draft) return this.store.updateDraft(draft.id, data, actor.userId)
      const version = quotes.reduce((m, q) => Math.max(m, q.version), 0) + 1
      return this.store.createDraft({ requestId: id, version, ...data, actorId: actor.userId })
    })
  }

  async send(actor: StaffContext, id: string) {
    const r = await this.mustGet(id)
    const quotes = await this.store.quotesFor(id)
    const draft = quotes.find((q) => q.status === 'draft')
    if (!draft) throw new ConflictException('Prepare a quote first.')
    if (r.status !== 'new') throw new ConflictException('The request is not waiting for a quote.')
    const problems = quoteProblems(draft.lines, draft.totalGhs)
    if (problems.length) throw new UnprocessableEntityException(problems.join(' '))
    const days = await this.config.quoteValidityDays()
    await guard(() => this.store.rpcSend(draft.id, days, actor.userId))
    return this.detail(id)
  }

  async withdraw(actor: StaffContext, id: string, reason: string) {
    const quotes = await this.store.quotesFor(id)
    const open = quotes.find((q) => q.status === 'draft' || q.status === 'sent')
    if (!open) throw new ConflictException('There is no open quote to withdraw.')
    await guard(() => this.store.rpcWithdraw(open.id, reason, actor.userId))
    return this.detail(id)
  }

  /** The employer's answer, logged by staff (for example after a phone call). The main site records the same thing itself. */
  async respond(actor: StaffContext, id: string, body: QuoteResponseInput) {
    const quotes = await this.store.quotesFor(id)
    const sent = quotes.find((q) => q.status === 'sent')
    if (!sent) throw new ConflictException('There is no sent quote waiting for an answer.')
    if (sent.validUntil && new Date(sent.validUntil).getTime() <= Date.now()) {
      throw new ConflictException('This quote has expired. Prepare a new one.')
    }
    await guard(() => this.store.rpcRespond(sent.id, 'sent', body.response, 'staff_logged', body.note?.trim() || null, actor.userId))
    return this.detail(id)
  }

  /** Expire quotes whose validity ran out. Safe to repeat. */
  async expireDue(now = new Date()): Promise<number> {
    let n = 0
    for (const q of await this.store.sentQuotesDueBy(now)) {
      try {
        await this.store.rpcRespond(q.id, 'sent', 'expired', 'employer', null, null)
        n++
      } catch (e) {
        if (!(e instanceof StoreError && e.kind === 'conflict')) throw e
      }
    }
    return n
  }

  // Payment -----------------------------------------------------------------------------------
  async markPaid(actor: StaffContext, id: string, body: PaymentReceivedInput): Promise<PaymentRecord> {
    const p = await this.store.paymentFor(id)
    if (!p) throw new NotFoundException('There is no payment on this request yet. It is created when the quote is accepted.')
    if (p.status !== 'pending') throw new ConflictException('This payment is already recorded.')
    return guard(() => this.store.markReceived(p.id, body.momoReference, actor.userId))
  }

  // Pricing -----------------------------------------------------------------------------------
  benchmarks() {
    return this.store.benchmarks()
  }
  saveBenchmark(actor: StaffContext, i: BenchmarkInput) {
    return guard(() => this.store.saveBenchmark(i, actor.userId))
  }
  patchBenchmark(actor: StaffContext, id: string, p: { amountGhs?: number; active?: boolean }, reason: string) {
    return guard(() => this.store.patchBenchmark(id, p, actor.userId, reason))
  }

  async bands(xpertId?: string) {
    const rows = await this.store.bands(xpertId)
    const names = await this.xperts.xpertsByIds([...new Set(rows.map((b) => b.xpertId))])
    return rows.map((b) => ({ ...b, xpertName: names.get(b.xpertId)?.fullName ?? null }))
  }
  async saveBand(actor: StaffContext, i: BandInput) {
    if (!(await this.xperts.getXpert(i.xpertId))) throw new BadRequestException('That Xpert was not found.')
    const saved = await guard(() => this.store.saveBand(i, actor.userId))
    return (await this.bands(i.xpertId)).find((b) => b.id === saved.id) ?? saved
  }
  async patchBand(actor: StaffContext, id: string, p: { minGhs?: number; maxGhs?: number; active?: boolean }, reason: string) {
    const current = (await this.bands()).find((b) => b.id === id)
    if (!current) throw new NotFoundException('Band not found')
    const min = p.minGhs ?? current.minGhs
    const max = p.maxGhs ?? current.maxGhs
    if (max < min) throw new UnprocessableEntityException('The top of the band cannot be below the bottom.')
    return guard(() => this.store.patchBand(id, p, actor.userId, reason))
  }
}
