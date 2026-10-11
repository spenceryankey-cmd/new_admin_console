import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common'
import { z } from 'zod'
import {
  bandSchema,
  bandUpdateSchema,
  benchmarkSchema,
  benchmarkUpdateSchema,
  cancelRequestSchema,
  composeQuoteSchema,
  createRequestSchema,
  paymentReceivedSchema,
  quoteResponseSchema,
  requestListQuerySchema,
  withdrawQuoteSchema,
  type BandInput,
  type BenchmarkInput,
  type ComposeQuoteInput,
  type CreateRequestInput,
  type PaymentReceivedInput,
  type QuoteResponseInput,
  type RequestListQuery,
} from '@beyondx/shared'
import { CurrentStaff, RequirePermissions } from '../auth/decorators'
import type { StaffContext } from '../auth/staff-context'
import { ZodPipe } from '../common/zod.pipe'
import { RequestsService } from './requests.service'

const uuid = new ZodPipe(z.string().uuid())

@Controller('requests')
export class RequestsController {
  constructor(private readonly svc: RequestsService) {}

  @Get('counts')
  @RequirePermissions('quotes.read')
  counts() {
    return this.svc.counts()
  }

  @Get()
  @RequirePermissions('quotes.read')
  list(@Query(new ZodPipe(requestListQuerySchema)) q: RequestListQuery) {
    return this.svc.list(q)
  }

  @Post()
  @RequirePermissions('quotes.compose')
  create(@CurrentStaff() actor: StaffContext, @Body(new ZodPipe(createRequestSchema)) body: CreateRequestInput) {
    return this.svc.create(actor, body).then((request) => ({ request }))
  }

  @Get(':id')
  @RequirePermissions('quotes.read')
  detail(@Param('id', uuid) id: string) {
    return this.svc.detail(id)
  }

  @Post(':id/cancel')
  @RequirePermissions('quotes.compose')
  cancel(@CurrentStaff() actor: StaffContext, @Param('id', uuid) id: string, @Body(new ZodPipe(cancelRequestSchema)) body: { reason: string }) {
    return this.svc.cancel(actor, id, body.reason)
  }

  @Put(':id/quote')
  @RequirePermissions('quotes.compose')
  compose(@CurrentStaff() actor: StaffContext, @Param('id', uuid) id: string, @Body(new ZodPipe(composeQuoteSchema)) body: ComposeQuoteInput) {
    return this.svc.compose(actor, id, body).then(() => this.svc.detail(id))
  }

  @Post(':id/quote/send')
  @RequirePermissions('quotes.compose')
  send(@CurrentStaff() actor: StaffContext, @Param('id', uuid) id: string) {
    return this.svc.send(actor, id)
  }

  @Post(':id/quote/withdraw')
  @RequirePermissions('quotes.compose')
  withdraw(@CurrentStaff() actor: StaffContext, @Param('id', uuid) id: string, @Body(new ZodPipe(withdrawQuoteSchema)) body: { reason: string }) {
    return this.svc.withdraw(actor, id, body.reason)
  }

  @Post(':id/quote/response')
  @RequirePermissions('quotes.compose')
  respond(@CurrentStaff() actor: StaffContext, @Param('id', uuid) id: string, @Body(new ZodPipe(quoteResponseSchema)) body: QuoteResponseInput) {
    return this.svc.respond(actor, id, body)
  }

  @Post(':id/payment/received')
  @RequirePermissions('payments.record')
  paid(@CurrentStaff() actor: StaffContext, @Param('id', uuid) id: string, @Body(new ZodPipe(paymentReceivedSchema)) body: PaymentReceivedInput) {
    return this.svc.markPaid(actor, id, body).then(() => this.svc.detail(id))
  }
}

@Controller('pricing')
export class PricingController {
  constructor(private readonly svc: RequestsService) {}

  @Get('benchmarks')
  @RequirePermissions('benchmarks.edit')
  benchmarks() {
    return this.svc.benchmarks().then((rates) => ({ rates }))
  }

  @Post('benchmarks')
  @RequirePermissions('benchmarks.edit')
  saveBenchmark(@CurrentStaff() actor: StaffContext, @Body(new ZodPipe(benchmarkSchema)) body: BenchmarkInput) {
    return this.svc.saveBenchmark(actor, body).then((rate) => ({ rate }))
  }

  @Patch('benchmarks/:id')
  @RequirePermissions('benchmarks.edit')
  patchBenchmark(@CurrentStaff() actor: StaffContext, @Param('id', uuid) id: string, @Body(new ZodPipe(benchmarkUpdateSchema)) body: { amountGhs?: number; active?: boolean; reason: string }) {
    return this.svc.patchBenchmark(actor, id, body, body.reason).then((rate) => ({ rate }))
  }

  @Get('bands')
  @RequirePermissions('pricing.bands.edit')
  bands(@Query('xpertId') xpertId?: string) {
    return this.svc.bands(xpertId || undefined).then((bands) => ({ bands }))
  }

  @Post('bands')
  @RequirePermissions('pricing.bands.edit')
  saveBand(@CurrentStaff() actor: StaffContext, @Body(new ZodPipe(bandSchema)) body: BandInput) {
    return this.svc.saveBand(actor, body).then((band) => ({ band }))
  }

  @Patch('bands/:id')
  @RequirePermissions('pricing.bands.edit')
  patchBand(@CurrentStaff() actor: StaffContext, @Param('id', uuid) id: string, @Body(new ZodPipe(bandUpdateSchema)) body: { minGhs?: number; maxGhs?: number; active?: boolean; reason: string }) {
    return this.svc.patchBand(actor, id, body, body.reason).then((band) => ({ band }))
  }
}
