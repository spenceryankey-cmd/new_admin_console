import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ENV, type Env } from './config/env'
import { AuditController } from './audit/audit.controller'
import { AuditService } from './audit/audit.service'
import { AccessService } from './auth/access.service'
import { AuthGuard } from './auth/auth.guard'
import { InboxController, NotificationsController } from './inbox/inbox.controller'
import { SupabaseInboxStore } from './inbox/inbox.store'
import { INBOX_SOURCE, INBOX_STORE, NOTIFICATION_SINK, NotConnectedInboxSource, NotConnectedNotificationSink } from './inbox/inbox.ports'
import { InboxService } from './inbox/inbox.service'
import { NotificationsService } from './inbox/notifications.service'
import { JwtTokenVerifier, TOKEN_VERIFIER } from './auth/token.verifier'
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
import { ConsoleXpertStore, XPERT_RECORDS, XPERT_STORE } from './xperts/xpert.store'
import { IntegrityService } from './xperts/integrity.service'
import { HetznerService } from './hetzner/hetzner.service'
import { PostgresXpertRecords } from './hetzner/postgres.xpert.records'
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
    RequestsController, PricingController, JobsController, ChangeOrdersController, RecurringController, FlagsController, FeedbackController, ReliabilityController, CoordinatorsController, InboxController, NotificationsController,
  ],
  providers: [
    AccessService,
    AuditService,
    StaffService,
    RolesService,
    HetznerService,
    IntegrityService,
    { provide: XPERT_RECORDS, useClass: PostgresXpertRecords },
    { provide: XPERT_STORE, useClass: ConsoleXpertStore },
    { provide: REQUEST_STORE, useClass: SupabaseRequestStore },
    RequestsService,
    { provide: JOB_STORE, useClass: SupabaseJobStore },
    JobsService,
    { provide: TRUST_STORE, useClass: SupabaseTrustStore },
    // The messages and the bell belong to the main site. Until its tables are known these refuse honestly (see docs/PHASE8.md).
    { provide: INBOX_SOURCE, useClass: NotConnectedInboxSource },
    { provide: NOTIFICATION_SINK, useClass: NotConnectedNotificationSink },
    { provide: INBOX_STORE, useClass: SupabaseInboxStore },
    InboxService,
    NotificationsService,
    TrustService,
    ConfigService,
    XpertsService,
    ScreeningService,
    SweepsService,
    { provide: TOKEN_VERIFIER, useFactory: (env: Env) => JwtTokenVerifier.fromUrl(env.SUPABASE_URL), inject: [ENV] },
    // Order matters: sign in first, then permissions.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
