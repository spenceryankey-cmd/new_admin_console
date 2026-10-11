import { Controller, Get, Query } from '@nestjs/common'
import { auditQuerySchema, type AuditQuery } from '@beyondx/shared'
import { RequirePermissions } from '../auth/decorators'
import { ZodPipe } from '../common/zod.pipe'
import { AuditService } from './audit.service'

@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions('audit.read')
  list(@Query(new ZodPipe(auditQuerySchema)) query: AuditQuery) {
    return this.audit.list(query)
  }
}
