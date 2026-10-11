import { Body, Controller, ForbiddenException, Get, Param, Post, Put, Query } from '@nestjs/common'
import { z } from 'zod'
import {
  addEvidenceSchema,
  addGuarantorSchema,
  addReferenceSchema,
  approveSchema,
  callbackSchema,
  claimSchema,
  configValueSchema,
  logReferenceCallSchema,
  retractGuarantorSchema,
  reviewEvidenceSchema,
  transitionSchema,
  uploadUrlSchema,
  xpertListQuerySchema,
  type AddEvidenceInput,
  type AddGuarantorInput,
  type AddReferenceInput,
  type ApproveInput,
  type CallbackInput,
  type LogReferenceCallInput,
  type ReviewEvidenceInput,
  type TransitionInput,
  type XpertListQuery,
} from '@beyondx/shared'
import { AnyStaff, CurrentStaff, RequirePermissions } from '../auth/decorators'
import type { StaffContext } from '../auth/staff-context'
import { ZodPipe } from '../common/zod.pipe'
import { ConfigService } from './config.service'
import { ScreeningService } from './screening.service'
import { SweepsService } from './sweeps.service'
import { XpertsService } from './xperts.service'

const idParam = new ZodPipe(z.string().trim().min(1).max(80))
const uuidParam = new ZodPipe(z.string().uuid())
const kindParam = new ZodPipe(z.enum(['guarantors', 'evidence', 'references']))
const keyParam = new ZodPipe(z.string().regex(/^[A-Za-z.]{3,80}$/))

@Controller('xperts')
export class XpertsController {
  constructor(
    private readonly xperts: XpertsService,
    private readonly screening: ScreeningService,
  ) {}

  @Get()
  @RequirePermissions('xperts.read')
  list(@Query(new ZodPipe(xpertListQuerySchema)) q: XpertListQuery) {
    return this.xperts.list(q)
  }

  @Get(':id')
  @RequirePermissions('xperts.read')
  detail(@CurrentStaff() actor: StaffContext, @Param('id', idParam) id: string) {
    return this.xperts.detail(id, actor)
  }

  // The status rules decide who may make which move, so any signed in staff member may ask.
  @Post(':id/transition')
  @AnyStaff()
  transition(@CurrentStaff() actor: StaffContext, @Param('id', idParam) id: string, @Body(new ZodPipe(transitionSchema)) body: TransitionInput) {
    return this.xperts.transition(actor, id, body)
  }

  @Post(':id/approve')
  @RequirePermissions('xperts.approve')
  approve(@CurrentStaff() actor: StaffContext, @Param('id', idParam) id: string, @Body(new ZodPipe(approveSchema)) body: ApproveInput) {
    return this.xperts.approve(actor, id, body)
  }

  @Post(':id/guarantor')
  @RequirePermissions('guarantors.review')
  addGuarantor(@CurrentStaff() actor: StaffContext, @Param('id', idParam) id: string, @Body(new ZodPipe(addGuarantorSchema)) body: AddGuarantorInput) {
    return this.screening.addGuarantor(actor, id, body).then((guarantor) => ({ guarantor }))
  }
}

@Controller('queues')
export class QueuesController {
  constructor(
    private readonly xperts: XpertsService,
    private readonly screening: ScreeningService,
  ) {}

  @Get('counts')
  @RequirePermissions('dashboard.view')
  counts() {
    return this.xperts.counts()
  }

  @Get('guarantors')
  @RequirePermissions('guarantors.review')
  guarantors() {
    return this.screening.guarantorQueue()
  }

  @Get('evidence')
  @RequirePermissions('evidence.review')
  evidence() {
    return this.screening.evidenceQueue()
  }

  @Get('references')
  @RequirePermissions('references.review')
  references() {
    return this.screening.referenceQueue()
  }

  @Get('approvals')
  @RequirePermissions('xperts.read')
  approvals() {
    return this.screening.approvalQueue()
  }

  @Post(':kind/:id/claim')
  @AnyStaff()
  claim(
    @CurrentStaff() actor: StaffContext,
    @Param('kind', kindParam) kind: 'guarantors' | 'evidence' | 'references',
    @Param('id', uuidParam) id: string,
    @Body(new ZodPipe(claimSchema)) body: { release: boolean },
  ) {
    const needed = kind === 'guarantors' ? 'guarantors.review' : kind === 'evidence' ? 'evidence.review' : 'references.review'
    if (!actor.permissions.has(needed) && actor.role !== 'super_admin') {
      throw new ForbiddenException('Your role cannot work this queue.')
    }
    return this.screening.claim(actor, kind, id, body.release).then((item) => ({ item }))
  }
}

@Controller('guarantors')
export class GuarantorsController {
  constructor(private readonly screening: ScreeningService) {}

  @Post(':id/explainer-sent')
  @RequirePermissions('guarantors.review')
  explainer(@CurrentStaff() actor: StaffContext, @Param('id', uuidParam) id: string) {
    return this.screening.markExplainerSent(actor, id).then((guarantor) => ({ guarantor }))
  }

  @Post(':id/callback')
  @RequirePermissions('guarantors.review')
  callback(@CurrentStaff() actor: StaffContext, @Param('id', uuidParam) id: string, @Body(new ZodPipe(callbackSchema)) body: CallbackInput) {
    return this.screening.recordCallback(actor, id, body).then((guarantor) => ({ guarantor }))
  }

  @Post(':id/retract')
  @RequirePermissions('guarantors.review')
  retract(@CurrentStaff() actor: StaffContext, @Param('id', uuidParam) id: string, @Body(new ZodPipe(retractGuarantorSchema)) body: { reason: string }) {
    return this.screening.retract(actor, id, body.reason).then((guarantor) => ({ guarantor }))
  }
}

@Controller('evidence')
export class EvidenceController {
  constructor(private readonly screening: ScreeningService) {}

  @Post('upload-url')
  @RequirePermissions('evidence.review')
  uploadUrl(@Body(new ZodPipe(uploadUrlSchema)) body: { xpertId: string; fileName: string }) {
    return this.screening.uploadUrl(body.xpertId, body.fileName)
  }

  @Post()
  @RequirePermissions('evidence.review')
  add(@CurrentStaff() actor: StaffContext, @Body(new ZodPipe(addEvidenceSchema)) body: AddEvidenceInput) {
    return this.screening.addEvidence(actor, body).then((evidence) => ({ evidence }))
  }

  @Get(':id/file-url')
  @RequirePermissions('xperts.read')
  file(@Param('id', uuidParam) id: string) {
    return this.screening.evidenceFile(id)
  }

  @Get(':id/checklist')
  @RequirePermissions('xperts.read')
  checklist(@Param('id', uuidParam) id: string) {
    return this.screening.evidenceChecklist(id)
  }

  @Post(':id/review')
  @RequirePermissions('evidence.review')
  review(@CurrentStaff() actor: StaffContext, @Param('id', uuidParam) id: string, @Body(new ZodPipe(reviewEvidenceSchema)) body: ReviewEvidenceInput) {
    return this.screening.reviewEvidence(actor, id, body).then((evidence) => ({ evidence }))
  }
}

@Controller('references')
export class ReferencesController {
  constructor(private readonly screening: ScreeningService) {}

  @Get('script')
  @RequirePermissions('references.review')
  script() {
    return this.screening.referenceScript()
  }

  @Post()
  @RequirePermissions('references.review')
  add(@CurrentStaff() actor: StaffContext, @Body(new ZodPipe(addReferenceSchema)) body: AddReferenceInput) {
    return this.screening.addReference(actor, body).then((reference) => ({ reference }))
  }

  @Post(':id/calls')
  @RequirePermissions('references.review')
  call(@CurrentStaff() actor: StaffContext, @Param('id', uuidParam) id: string, @Body(new ZodPipe(logReferenceCallSchema)) body: LogReferenceCallInput) {
    return this.screening.logReferenceCall(actor, id, body).then((reference) => ({ reference }))
  }
}

@Controller('config')
export class ConfigController {
  constructor(private readonly config: ConfigService) {}

  @Get()
  @RequirePermissions('settings.read')
  async all() {
    const [entries, screening] = await Promise.all([this.config.entries(), this.config.screening()])
    return { entries, ...screening }
  }

  @Put(':key')
  @RequirePermissions('settings.edit')
  async set(@CurrentStaff() actor: StaffContext, @Param('key', keyParam) key: string, @Body(new ZodPipe(configValueSchema)) body: { value: unknown; reason: string }) {
    await this.config.set(actor, key, body.value, body.reason)
    return { ok: true }
  }
}

@Controller('sweeps')
export class SweepsController {
  constructor(private readonly sweeps: SweepsService) {}

  @Post('run')
  @RequirePermissions('settings.edit')
  run() {
    return this.sweeps.run()
  }
}
