// Development and tests only. Builds the REAL controllers, guards and services on an in memory
// store, so the web app can be tried without Supabase and tests can call every route. Not used in production.
import 'reflect-metadata'
import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { NestFactory } from '@nestjs/core'
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, ROLES, isRole, type Role } from '@beyondx/shared'
import { AuditService } from '../audit/audit.service'
import { AccessService } from '../auth/access.service'
import { AuthGuard } from '../auth/auth.guard'
import { TOKEN_VERIFIER } from '../auth/token.verifier'
import { MeController } from '../me.controller'
import { PermissionsGuard } from '../rbac/permissions.guard'
import { ENV } from '../config/env'
import { ConfigService } from '../xperts/config.service'
import { FakeStore } from '../xperts/fake.store'
import { ScreeningService } from '../xperts/screening.service'
import { SweepsService } from '../xperts/sweeps.service'
import { IntegrityService } from '../xperts/integrity.service'
import { PricingController, RequestsController } from '../requests/requests.controller'
import { FakeRequestStore } from '../requests/fake.request.store'
import { REQUEST_STORE } from '../requests/request.store'
import { RequestsService } from '../requests/requests.service'
import { ChangeOrdersController, JobsController, RecurringController } from '../jobs/jobs.controller'
import { FakeJobStore } from '../jobs/fake.job.store'
import { JOB_STORE } from '../jobs/job.store'
import { JobsService } from '../jobs/jobs.service'
import { CoordinatorsController, FeedbackController, FlagsController, ReliabilityController } from '../trust/trust.controller'
import { FakeTrustStore } from '../trust/fake.trust.store'
import { TRUST_STORE } from '../trust/trust.store'
import { TrustService } from '../trust/trust.service'
import { XPERT_STORE } from '../xperts/xpert.store'
import { XpertsService } from '../xperts/xperts.service'
import { ConfigController, EvidenceController, GuarantorsController, QueuesController, ReferencesController, SweepsController, XpertsController } from '../xperts/xperts.controller'

export const MOCK_USER_ID = '00000000-0000-0000-0000-000000000001'
const uid = MOCK_USER_ID
const day = 86_400_000
const ago = (d: number) => new Date(Date.now() - d * day).toISOString()

const store = new FakeStore()
const rstore = new FakeRequestStore()
const jstore = new FakeJobStore(rstore)
const tstore = new FakeTrustStore(jstore, store)
const seed = async () => {
  store.addXpert('x1', 'guarantor_pending', { fullName: 'Kwame Asante', phone: '0244111222', homeArea: 'Madina', skills: ['Skilled Trades'], createdAt: ago(5) })
  store.addXpert('x2', 'guarantor_pending', { fullName: 'Esi Owusu', phone: '0201333444', homeArea: 'Tema', skills: ['Facility & Cleaning'], createdAt: ago(13) })
  store.addXpert('x3', 'skill_verification', { fullName: 'Yaw Boateng', phone: '0555222333', homeArea: 'Kasoa', skills: ['Skilled Trades', 'Painting & Finishing'], createdAt: ago(20) })
  store.addXpert('x4', 'skill_verification', { fullName: 'Abena Mensah', phone: '0277888999', homeArea: 'Spintex', skills: ['Repairs & Maintenance'], createdAt: ago(9) })
  store.addXpert('x5', 'provisional_active', { fullName: 'Kofi Adjei', phone: '0233555666', homeArea: 'Osu', skills: ['Skilled Trades'], accountActive: true, verificationSource: 'direct_beyondx', activatedAt: ago(30), createdAt: ago(40) })
  store.addXpert('x6', 'full_active', { fullName: 'Akosua Frimpong', phone: '0244999000', homeArea: 'Dansoman', skills: ['Facility & Cleaning'], accountActive: true, verificationSource: 'coordinator', activatedAt: ago(90), createdAt: ago(120) })
  store.addXpert('x8', 'full_active', { fullName: 'Yaw Tiler', phone: '0244777000', homeArea: 'Madina', skills: ['Skilled Trades'], accountActive: true, verificationSource: 'direct_beyondx', activatedAt: ago(60), createdAt: ago(80) })
  store.addXpert('x9', 'provisional_active', { fullName: 'Kojo Mason', phone: '0244777111', homeArea: 'Tema', skills: ['Skilled Trades', 'Painting & Finishing'], accountActive: true, verificationSource: 'direct_beyondx', activatedAt: ago(10), createdAt: ago(20) })
  store.addXpert('x7', 'applied', { fullName: 'Nana Ofori', phone: '0266123123', createdAt: ago(1) })
  const g1 = await store.createGuarantor({ xpertId: 'x1', name: 'Mr Yeboah', contact: '0244555111', relationship: 'Former employer', namedAt: ago(5), actorId: null, reason: '' })
  await store.createGuarantor({ xpertId: 'x2', name: 'Mrs Darko', contact: '0201888777', relationship: 'Church elder', namedAt: ago(13), actorId: null, reason: '' })
  void g1
  for (const [x, name, contact, outcome] of [['x3', 'Mr Quaye', '0244000111', 'yes'], ['x4', 'Mrs Tetteh', '0244000222', 'yes']] as const) {
    const g = await store.createGuarantor({ xpertId: x, name, contact, relationship: 'Employer', namedAt: ago(15), actorId: null, reason: '' })
    await store.patchGuarantor(g.id, { explainer_sent_at: ago(14), callback_outcome: outcome })
  }
  await store.createEvidence({ xpertId: 'x3', taskType: 'Tiling', evidenceType: 'submitted_evidence', link: 'https://example.com/tiling.jpg', filePath: null, actorId: uid })
  await store.createEvidence({ xpertId: 'x4', taskType: 'Electrical', evidenceType: 'certification', link: 'https://example.com/cert.pdf', filePath: null, actorId: uid })
  await store.createReference({ xpertId: 'x5', name: 'Ama Serwaa', contact: '0244777888', relationship: 'My sister', warnings: ['The relationship suggests a family member. A reference cannot be family.'], actorId: uid })
  await store.createReference({ xpertId: 'x6', name: 'Mr Lartey', contact: '0244666555', relationship: 'Former client', warnings: [], actorId: uid })
  store.hist.unshift({ xpertId: 'x5', id: 90, oldStatus: 'skill_verification', newStatus: 'provisional_active', changedBy: uid, changedByName: 'Spencer Yankey', automatic: false, trigger: 'admin_approved', reason: null, changedAt: ago(30) })
}

const seedRequests = async () => {
  jstore.bandRows.push({ xpertId: 'x8', category: 'Skilled Trades', minGhs: 400, maxGhs: 600 })
  const mk = (employerName: string, category: string, description: string, location: string, timing: string) => rstore.createRequest({ employerName, employerPhone: '0244001122', category, description, location, timing, photos: [] }, uid)
  await rstore.saveBenchmark({ category: 'Skilled Trades', unit: 'per_job', amountGhs: 450, reason: 'Seed' })
  await rstore.saveBenchmark({ category: 'Skilled Trades', unit: 'per_day', amountGhs: 180, reason: 'Seed' })
  await rstore.saveBenchmark({ category: 'Facility & Cleaning', unit: 'per_hour', amountGhs: 40, reason: 'Seed' })
  await mk('Mr Adu', 'Skilled Trades', 'Tile a 12 square metre kitchen floor. Tiles are already bought.', 'Madina, Accra', 'Saturday morning')
  await mk('Mrs Ofori', 'Facility & Cleaning', 'Deep clean of a three bedroom flat before move in.', 'East Legon', 'Next Monday')
  const r3 = await mk('Kojo Mensah', 'Repairs & Maintenance', 'Replace the main breaker and check the wiring.', 'Tema', 'This week')
  const a = { description: 'Labour', amountGhs: 300 }
  const q = await rstore.createDraft({ requestId: r3.id, version: 1, totalGhs: 420, lines: [a, { description: 'Parts', amountGhs: 120 }], notes: null, actorId: uid })
  await rstore.rpcSend(q.id, 3, uid)
}

/** Builds the app with sample data, signed in as `role`. Call once per process: the sample data lives in module level stores. */
export async function buildMockApp(role: Role, aal: 'aal1' | 'aal2' = 'aal2') {
  const permissions = role === 'super_admin' ? [...PERMISSIONS] : [...DEFAULT_ROLE_PERMISSIONS[role]]
  const staff = { userId: uid, email: 'root@beyondxco.com', fullName: 'Spencer Yankey', role, isActive: true, permissions: new Set(permissions) }

  @Module({
    controllers: [MeController, XpertsController, QueuesController, GuarantorsController, EvidenceController, ReferencesController, ConfigController, SweepsController, RequestsController, PricingController, JobsController, ChangeOrdersController, RecurringController, FlagsController, FeedbackController, ReliabilityController, CoordinatorsController],
    providers: [
      { provide: ENV, useValue: { SWEEPS_ENABLED: 'false' } },
      { provide: XPERT_STORE, useValue: store },
      { provide: REQUEST_STORE, useValue: rstore },
      RequestsService,
      { provide: JOB_STORE, useValue: jstore },
      JobsService,
      { provide: TRUST_STORE, useValue: tstore },
      TrustService,
      { provide: AuditService, useValue: { record: async () => undefined } },
      { provide: AccessService, useValue: { loadStaff: async () => staff } },
      { provide: TOKEN_VERIFIER, useValue: { verify: async () => ({ userId: uid, aal }) } },
      ConfigService, XpertsService, ScreeningService, SweepsService,
      { provide: IntegrityService, useValue: { check: async () => ({ checked: 0, orphans: [] }) } },
      { provide: APP_GUARD, useClass: AuthGuard },
      { provide: APP_GUARD, useClass: PermissionsGuard },
    ],
  })
  class MockModule {}

  await seed()
  await seedRequests()
  return NestFactory.create(MockModule, { logger: ['error', 'warn'] })
}
