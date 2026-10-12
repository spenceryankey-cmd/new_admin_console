import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common'
import { z } from 'zod'
import {
  cancelJobSchema,
  changeOrderListQuerySchema,
  changeOrderSchema,
  confirmSchema,
  dispatchSchema,
  jobListQuerySchema,
  noShowSchema,
  promoteSchema,
  setBackupSchema,
  recurringPatchSchema,
  recurringSchema,
  rejectChangeOrderSchema,
  replaceSchema,
  type ChangeOrderInput,
  type JobListQuery,
  type RecurringInput,
} from '@beyondx/shared'
import { CurrentStaff, RequirePermissions } from '../auth/decorators'
import type { StaffContext } from '../auth/staff-context'
import { ZodPipe } from '../common/zod.pipe'
import { JobsService } from './jobs.service'

const uuid = new ZodPipe(z.string().uuid())
const reasonOnly = new ZodPipe(z.object({ reason: z.string().trim().min(3).max(1000) }))

@Controller('jobs')
export class JobsController {
  constructor(private readonly svc: JobsService) {}

  @Get('counts')
  @RequirePermissions('jobs.monitor')
  counts() {
    return this.svc.counts()
  }

  @Get('attention')
  @RequirePermissions('jobs.monitor')
  attention() {
    return this.svc.attention().then((jobs) => ({ jobs }))
  }

  @Get()
  @RequirePermissions('jobs.monitor')
  list(@Query(new ZodPipe(jobListQuerySchema)) q: JobListQuery) {
    return this.svc.list(q)
  }

  @Get(':id')
  @RequirePermissions('jobs.monitor')
  detail(@Param('id', uuid) id: string) {
    return this.svc.detail(id)
  }

  @Post(':id/dispatch')
  @RequirePermissions('dispatch.match')
  dispatch(@CurrentStaff() a: StaffContext, @Param('id', uuid) id: string, @Body(new ZodPipe(dispatchSchema)) b: { xpertId: string; backupXpertId: string }) {
    return this.svc.dispatch(a, id, b.xpertId, b.backupXpertId)
  }

  @Post(':id/backup')
  @RequirePermissions('dispatch.match')
  setBackup(@CurrentStaff() a: StaffContext, @Param('id', uuid) id: string, @Body(new ZodPipe(setBackupSchema)) b: { xpertId: string; reason?: string }) {
    return this.svc.setBackup(a, id, b.xpertId, b.reason)
  }

  @Post(':id/promote-backup')
  @RequirePermissions('dispatch.promote')
  promote(@CurrentStaff() a: StaffContext, @Param('id', uuid) id: string, @Body(new ZodPipe(promoteSchema)) b: { reason: string }) {
    return this.svc.promoteBackup(a, id, b.reason)
  }

  @Post(':id/no-show')
  @RequirePermissions('dispatch.promote')
  noShow(@CurrentStaff() a: StaffContext, @Param('id', uuid) id: string, @Body(new ZodPipe(noShowSchema)) b: { note?: string }) {
    return this.svc.noShow(a, id, b.note)
  }

  @Post(':id/start')
  @RequirePermissions('dispatch.match')
  start(@CurrentStaff() a: StaffContext, @Param('id', uuid) id: string) {
    return this.svc.start(a, id)
  }

  @Post(':id/replace')
  @RequirePermissions('jobs.replace')
  replace(@CurrentStaff() a: StaffContext, @Param('id', uuid) id: string, @Body(new ZodPipe(replaceSchema)) b: { xpertId: string; reason: string }) {
    return this.svc.replace(a, id, b.xpertId, b.reason)
  }

  @Post(':id/confirm')
  @RequirePermissions('dispatch.match')
  confirm(@CurrentStaff() a: StaffContext, @Param('id', uuid) id: string, @Body(new ZodPipe(confirmSchema)) b: { side: 'employer' | 'xpert' }) {
    return this.svc.confirm(a, id, b.side)
  }

  @Post(':id/cancel')
  @RequirePermissions('dispatch.match')
  cancel(@CurrentStaff() a: StaffContext, @Param('id', uuid) id: string, @Body(new ZodPipe(cancelJobSchema)) b: { reason: string }) {
    return this.svc.cancel(a, id, b.reason)
  }
}

@Controller('change-orders')
export class ChangeOrdersController {
  constructor(private readonly svc: JobsService) {}

  @Get()
  @RequirePermissions('changeorders.manage')
  list(@Query(new ZodPipe(changeOrderListQuerySchema)) q: { status?: any; jobId?: string }) {
    return this.svc.changeOrders(q).then((changeOrders) => ({ changeOrders }))
  }

  @Post()
  @RequirePermissions('changeorders.manage')
  log(@CurrentStaff() a: StaffContext, @Body(new ZodPipe(changeOrderSchema)) b: ChangeOrderInput) {
    return this.svc.logChangeOrder(a, b).then((changeOrder) => ({ changeOrder }))
  }

  @Post(':id/confirm')
  @RequirePermissions('changeorders.manage')
  confirm(@CurrentStaff() a: StaffContext, @Param('id', uuid) id: string, @Body(new ZodPipe(confirmSchema)) b: { side: 'employer' | 'xpert' }) {
    return this.svc.confirmChange(a, id, b.side).then((changeOrder) => ({ changeOrder }))
  }

  @Post(':id/reject')
  @RequirePermissions('changeorders.manage')
  reject(@CurrentStaff() a: StaffContext, @Param('id', uuid) id: string, @Body(new ZodPipe(rejectChangeOrderSchema)) b: { side: 'employer' | 'xpert'; note: string }) {
    return this.svc.rejectChange(a, id, b.side, b.note).then((changeOrder) => ({ changeOrder }))
  }

  @Post(':id/cancel')
  @RequirePermissions('changeorders.manage')
  cancel(@CurrentStaff() a: StaffContext, @Param('id', uuid) id: string, @Body(reasonOnly) b: { reason: string }) {
    return this.svc.cancelChange(a, id, b.reason).then((changeOrder) => ({ changeOrder }))
  }
}

@Controller('recurring')
export class RecurringController {
  constructor(private readonly svc: JobsService) {}

  @Get()
  @RequirePermissions('quotes.read')
  list() {
    return this.svc.recurring().then((services) => ({ services }))
  }

  @Post()
  @RequirePermissions('quotes.compose')
  create(@CurrentStaff() a: StaffContext, @Body(new ZodPipe(recurringSchema)) b: RecurringInput) {
    return this.svc.createRecurring(a, b).then((service) => ({ service }))
  }

  @Put(':id/active')
  @RequirePermissions('quotes.compose')
  async active(@CurrentStaff() a: StaffContext, @Param('id', uuid) id: string, @Body(new ZodPipe(recurringPatchSchema)) b: { active: boolean; reason: string }) {
    await this.svc.setRecurring(a, id, b.active, b.reason)
    return { ok: true }
  }

  @Post(':id/generate')
  @RequirePermissions('quotes.compose')
  async generate(@CurrentStaff() a: StaffContext, @Param('id', uuid) id: string) {
    await this.svc.generate(a, id)
    return { ok: true }
  }
}
