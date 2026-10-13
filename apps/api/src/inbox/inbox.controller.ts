import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { z } from 'zod'
import {
  handleInboxSchema,
  inboxListQuerySchema,
  previewNotificationSchema,
  sendNotificationSchema,
  type HandleInboxInput,
  type InboxListQuery,
  type PreviewNotificationInput,
  type SendNotificationInput,
} from '@beyondx/shared'
import { CurrentStaff, RequirePermissions } from '../auth/decorators'
import type { StaffContext } from '../auth/staff-context'
import { ZodPipe } from '../common/zod.pipe'
import { InboxService } from './inbox.service'
import { NotificationsService } from './notifications.service'

const ref = new ZodPipe(z.string().trim().min(1).max(120))
const page = new ZodPipe(z.object({ limit: z.coerce.number().int().min(1).max(100).default(30), offset: z.coerce.number().int().min(0).default(0) }))

@Controller('inbox')
export class InboxController {
  constructor(private readonly svc: InboxService) {}

  @Get()
  @RequirePermissions('inbox.read')
  list(@Query(new ZodPipe(inboxListQuerySchema)) q: InboxListQuery) {
    return this.svc.list(q)
  }

  @Get('counts')
  @RequirePermissions('inbox.read')
  counts() {
    return this.svc.counts()
  }

  @Post(':ref/handle')
  @RequirePermissions('inbox.handle')
  handle(@CurrentStaff() a: StaffContext, @Param('ref', ref) r: string, @Body(new ZodPipe(handleInboxSchema)) b: HandleInboxInput) {
    return this.svc.handle(a, r, b)
  }
}

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Post('preview')
  @RequirePermissions('notifications.send')
  preview(@Body(new ZodPipe(previewNotificationSchema)) b: PreviewNotificationInput) {
    return this.svc.preview(b.audience)
  }

  @Post('send')
  @RequirePermissions('notifications.send')
  send(@CurrentStaff() a: StaffContext, @Body(new ZodPipe(sendNotificationSchema)) b: SendNotificationInput) {
    return this.svc.send(a, b)
  }

  @Get('history')
  @RequirePermissions('notifications.send')
  history(@Query(page) q: { limit: number; offset: number }) {
    return this.svc.history(q)
  }
}
