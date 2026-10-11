import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common'
import { z } from 'zod'
import {
  assignXpertSchema,
  coordinatorActiveSchema,
  coordinatorSchema,
  counterFlagSchema,
  decideFlagSchema,
  feedbackSchema,
  flagListQuerySchema,
  raiseFlagSchema,
  type CoordinatorInput,
  type CounterFlagInput,
  type DecideFlagInput,
  type FeedbackInput,
  type FlagListQuery,
  type RaiseFlagInput,
} from '@beyondx/shared'
import { CurrentStaff, RequirePermissions } from '../auth/decorators'
import type { StaffContext } from '../auth/staff-context'
import { ZodPipe } from '../common/zod.pipe'
import { TrustService } from './trust.service'

const uuid = new ZodPipe(z.string().uuid())
const feedbackQuery = new ZodPipe(z.object({ limit: z.coerce.number().int().min(1).max(100).default(30), offset: z.coerce.number().int().min(0).default(0), xpertId: z.string().trim().max(80).optional() }))

@Controller('flags')
export class FlagsController {
  constructor(private readonly svc: TrustService) {}

  @Get()
  @RequirePermissions('flags.read')
  list(@Query(new ZodPipe(flagListQuerySchema)) q: FlagListQuery) {
    return this.svc.listFlags(q)
  }

  @Get(':id')
  @RequirePermissions('flags.read')
  detail(@Param('id', uuid) id: string) {
    return this.svc.flagDetail(id)
  }

  @Post()
  @RequirePermissions('flags.raise')
  raise(@CurrentStaff() a: StaffContext, @Body(new ZodPipe(raiseFlagSchema)) b: RaiseFlagInput) {
    return this.svc.raise(a, b)
  }

  @Post(':id/counter')
  @RequirePermissions('flags.raise')
  counter(@CurrentStaff() a: StaffContext, @Param('id', uuid) id: string, @Body(new ZodPipe(counterFlagSchema)) b: CounterFlagInput) {
    return this.svc.counter(a, id, b)
  }

  @Post(':id/investigate')
  @RequirePermissions('flags.decide')
  investigate(@CurrentStaff() a: StaffContext, @Param('id', uuid) id: string) {
    return this.svc.investigate(a, id)
  }

  @Post(':id/decide')
  @RequirePermissions('flags.decide')
  decide(@CurrentStaff() a: StaffContext, @Param('id', uuid) id: string, @Body(new ZodPipe(decideFlagSchema)) b: DecideFlagInput) {
    return this.svc.decide(a, id, b)
  }
}

@Controller('feedback')
export class FeedbackController {
  constructor(private readonly svc: TrustService) {}

  @Get()
  @RequirePermissions('feedback.read')
  list(@Query(feedbackQuery) q: { limit: number; offset: number; xpertId?: string }) {
    return this.svc.listFeedback(q)
  }

  @Post()
  @RequirePermissions('dispatch.match')
  log(@CurrentStaff() a: StaffContext, @Body(new ZodPipe(feedbackSchema)) b: FeedbackInput) {
    return this.svc.logFeedback(a, b).then((feedback) => ({ feedback }))
  }
}

@Controller('reliability')
export class ReliabilityController {
  constructor(private readonly svc: TrustService) {}

  @Get('counts')
  @RequirePermissions('dashboard.view')
  counts() {
    return this.svc.counts()
  }

  @Get(':xpertId')
  @RequirePermissions('reliability.read')
  one(@Param('xpertId') xpertId: string) {
    return this.svc.reliability(xpertId).then((reliability) => ({ reliability }))
  }
}

@Controller('coordinators')
export class CoordinatorsController {
  constructor(private readonly svc: TrustService) {}

  @Get()
  @RequirePermissions('coordinators.read')
  list() {
    return this.svc.coordinators().then((coordinators) => ({ coordinators }))
  }

  @Post()
  @RequirePermissions('coordinators.manage')
  create(@CurrentStaff() a: StaffContext, @Body(new ZodPipe(coordinatorSchema)) b: CoordinatorInput) {
    return this.svc.createCoordinator(a, b).then((coordinator) => ({ coordinator }))
  }

  @Get(':id')
  @RequirePermissions('coordinators.read')
  detail(@Param('id', uuid) id: string) {
    return this.svc.coordinatorDetail(id)
  }

  @Put(':id/active')
  @RequirePermissions('coordinators.manage')
  active(@CurrentStaff() a: StaffContext, @Param('id', uuid) id: string, @Body(new ZodPipe(coordinatorActiveSchema)) b: { active: boolean; reason: string }) {
    return this.svc.setCoordinatorActive(a, id, b.active, b.reason)
  }

  @Post(':id/xperts')
  @RequirePermissions('coordinators.manage')
  assign(@CurrentStaff() a: StaffContext, @Param('id', uuid) id: string, @Body(new ZodPipe(assignXpertSchema)) b: { xpertId: string; reason: string }) {
    return this.svc.assign(a, id, b.xpertId, b.reason)
  }
}
