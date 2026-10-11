import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { AuditController } from './audit/audit.controller'
import { AuditService } from './audit/audit.service'
import { AccessService } from './auth/access.service'
import { AuthGuard, SupabaseTokenVerifier, TOKEN_VERIFIER } from './auth/auth.guard'
import { MeController } from './me.controller'
import { PermissionsGuard } from './rbac/permissions.guard'
import { RolesController } from './roles/roles.controller'
import { RolesService } from './roles/roles.service'
import { StaffController } from './staff/staff.controller'
import { StaffService } from './staff/staff.service'
import { ConfigService } from './xperts/config.service'
import { ConfigController, EvidenceController, GuarantorsController, QueuesController, ReferencesController, SweepsController, XpertsController } from './xperts/xperts.controller'
import { ScreeningService } from './xperts/screening.service'
import { SweepsService } from './xperts/sweeps.service'
import { SupabaseXpertStore, XPERT_STORE } from './xperts/xpert.store'
import { XpertsService } from './xperts/xperts.service'
import { PricingController, RequestsController } from './requests/requests.controller'
import { REQUEST_STORE, SupabaseRequestStore } from './requests/request.store'
import { RequestsService } from './requests/requests.service'
import { ChangeOrdersController, JobsController, RecurringController } from './jobs/jobs.controller'
import { JOB_STORE, SupabaseJobStore } from './jobs/job.store'
import { JobsService } from './jobs/jobs.service'
import { CoordinatorsController, FeedbackController, FlagsController, ReliabilityController } from './trust/trust.controller'
import { SupabaseTrustStore, TRUST_STORE } from './trust/trust.store'
import { TrustService } from './trust/trust.service'
import { SupabaseModule } from './supabase/supabase.module'

@Module({
  imports: [SupabaseModule],
  controllers: [
    MeController, StaffController, RolesController, AuditController,
    XpertsController, QueuesController, GuarantorsController, EvidenceController, ReferencesController, ConfigController, SweepsController,
    RequestsController, PricingController, JobsController, ChangeOrdersController, RecurringController, FlagsController, FeedbackController, ReliabilityController, CoordinatorsController,
  ],
  providers: [
    AccessService,
    AuditService,
    StaffService,
    RolesService,
    { provide: XPERT_STORE, useClass: SupabaseXpertStore },
    { provide: REQUEST_STORE, useClass: SupabaseRequestStore },
    RequestsService,
    { provide: JOB_STORE, useClass: SupabaseJobStore },
    JobsService,
    { provide: TRUST_STORE, useClass: SupabaseTrustStore },
    TrustService,
    ConfigService,
    XpertsService,
    ScreeningService,
    SweepsService,
    { provide: TOKEN_VERIFIER, useClass: SupabaseTokenVerifier },
    // Order matters: sign in first, then permissions.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
