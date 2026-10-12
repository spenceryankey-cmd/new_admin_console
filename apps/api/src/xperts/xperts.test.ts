import 'reflect-metadata'
import { BadRequestException, ConflictException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common'
import { DEFAULT_ROLE_PERMISSIONS, type Permission, type Role, type StatusHistoryRow } from '@beyondx/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import type { StaffContext } from '../auth/staff-context'
import { ConfigService } from './config.service'
import { previousActiveStatus } from './facts'
import { FakeJobStore } from '../jobs/fake.job.store'
import { JobsService } from '../jobs/jobs.service'
import { FakeStore } from './fake.store'
import { ScreeningService } from './screening.service'
import { SweepsService } from './sweeps.service'
import { XpertsService } from './xperts.service'
import { RequestsService } from '../requests/requests.service'
import { FakeRequestStore } from '../requests/fake.request.store'

const staff = (role: Role, id: string = role): StaffContext => ({
  userId: id,
  email: `${id}@x.co`,
  fullName: id,
  role,
  isActive: true,
  permissions: new Set<Permission>(DEFAULT_ROLE_PERMISSIONS[role]),
})

let store: FakeStore
let xperts: XpertsService
let screening: ScreeningService
let sweeps: SweepsService

const ops = staff('ops_reviewer')
const boss = staff('decision_maker')

beforeEach(() => {
  store = new FakeStore()
  const config = new ConfigService(store)
  xperts = new XpertsService(store, config)
  screening = new ScreeningService(store, xperts, config)
  sweeps = new SweepsService(store, xperts, { SWEEPS_ENABLED: 'false' } as any, new RequestsService(new FakeRequestStore(), store, config), new JobsService(new FakeJobStore(new FakeRequestStore()), store, config, xperts), { check: async () => ({ checked: 3, orphans: [{ table: 'job', xpertId: 'gone' }] }) } as any)
})

const passTicks = { shows_task: true, shows_xpert: true, recent: true, quality: true }

describe('previousActiveStatus', () => {
  const row = (o: string | null, n: string): StatusHistoryRow => ({ id: 1, oldStatus: o as any, newStatus: n as any, changedBy: null, changedByName: null, automatic: false, trigger: null, reason: null, changedAt: '' })
  it('finds the level held before review, even after a move to suspended', () => {
    expect(previousActiveStatus([row('under_review', 'suspended'), row('full_active', 'under_review')])).toBe('full_active')
  })
  it('is null when there was none', () => {
    expect(previousActiveStatus([row('applied', 'guarantor_pending')])).toBeNull()
  })
})

describe('status changes', () => {
  it('refuses a move the state machine does not allow', async () => {
    store.addXpert('x1', 'applied')
    await expect(xperts.transition(boss, 'x1', { expectedFrom: 'applied', to: 'full_active', trigger: 'admin_approved' })).rejects.toBeInstanceOf(UnprocessableEntityException)
  })

  it('refuses when the status moved since the screen loaded', async () => {
    store.addXpert('x1', 'guarantor_pending')
    await expect(xperts.transition(boss, 'x1', { expectedFrom: 'applied', to: 'guarantor_pending', trigger: 'guarantor_named' })).rejects.toBeInstanceOf(ConflictException)
  })

  it('needs the right permission and a reason for review', async () => {
    store.addXpert('x1', 'full_active', { accountActive: true })
    const body = { expectedFrom: 'full_active', to: 'under_review', trigger: 'safety_concern' } as const
    await expect(xperts.transition(ops, 'x1', { ...body, reason: 'complaint' })).rejects.toBeInstanceOf(ForbiddenException)
    await expect(xperts.transition(boss, 'x1', body)).rejects.toBeInstanceOf(BadRequestException)
    await xperts.transition(boss, 'x1', { ...body, reason: 'Complaint from an employer' })
    expect(store.xperts.get('x1')!.status).toBe('under_review')
    expect(store.hist[0]!.reason).toBe('Complaint from an employer')
  })

  it('restores the level they held when review clears', async () => {
    store.addXpert('x1', 'full_active', { accountActive: true })
    await xperts.transition(boss, 'x1', { expectedFrom: 'full_active', to: 'under_review', trigger: 'no_shows', reason: 'Two no shows' })
    await expect(xperts.transition(boss, 'x1', { expectedFrom: 'under_review', to: 'provisional_active', trigger: 'review_outcome', reason: 'cleared' })).rejects.toBeInstanceOf(UnprocessableEntityException)
    await xperts.transition(boss, 'x1', { expectedFrom: 'under_review', to: 'full_active', trigger: 'review_outcome', reason: 'Cleared after the call' })
    expect(store.xperts.get('x1')!.status).toBe('full_active')
  })

  it('does not let the first pass reviewer remove an Xpert', async () => {
    store.addXpert('x1', 'under_review')
    store.guarantors.push({ id: 'g', xpertId: 'x1', name: 'G', contact: '024', relationship: null, namedAt: '', explainerMessageSentAt: null, callbackConfirmedAt: null, callbackOutcome: null, retractedAt: null, assignedTo: boss.userId, assignedToName: null })
    await expect(xperts.transition(boss, 'x1', { expectedFrom: 'under_review', to: 'removed', trigger: 'review_outcome', reason: 'Confirmed misconduct' })).rejects.toBeInstanceOf(UnprocessableEntityException)
    await xperts.transition(staff('super_admin', 'someone-else'), 'x1', { expectedFrom: 'under_review', to: 'removed', trigger: 'review_outcome', reason: 'Confirmed misconduct' })
    expect(store.xperts.get('x1')!.status).toBe('removed')
    expect(store.xperts.get('x1')!.accountActive).toBe(false)
  })
})

describe('guarantor queue', () => {
  async function applicant() {
    store.addXpert('x1', 'applied')
    const g = await screening.addGuarantor(ops, 'x1', { name: 'Kofi Mensah', contact: '0241112222', relationship: 'Employer' })
    return g
  }

  it('naming a guarantor moves the applicant to guarantor pending', async () => {
    await applicant()
    expect(store.xperts.get('x1')!.status).toBe('guarantor_pending')
  })

  it('a yes without the explainer does not confirm', async () => {
    const g = await applicant()
    await screening.recordCallback(ops, g.id, { outcome: 'yes' })
    expect(store.xperts.get('x1')!.status).toBe('guarantor_pending')
  })

  it('explainer then yes confirms and starts skill verification', async () => {
    const g = await applicant()
    await screening.markExplainerSent(ops, g.id)
    await screening.recordCallback(ops, g.id, { outcome: 'yes' })
    expect(store.xperts.get('x1')!.status).toBe('skill_verification')
    expect(store.hist.map((h) => h.newStatus).reverse()).toEqual(['guarantor_pending', 'guarantor_confirmed', 'skill_verification'])
  })

  it('a no closes the application', async () => {
    const g = await applicant()
    await screening.recordCallback(ops, g.id, { outcome: 'no', note: 'Does not know them' })
    expect(store.xperts.get('x1')!.status).toBe('blocked_closed')
  })

  it('a retraction sends an active Xpert to under review, even from the guarantor queue', async () => {
    store.addXpert('x2', 'full_active', { accountActive: true })
    const g = await store.createGuarantor({ xpertId: 'x2', name: 'G', contact: '0240000001', relationship: null, namedAt: null, actorId: null, reason: '' })
    await screening.retract(ops, g.id, 'The guarantor called to withdraw')
    expect(store.xperts.get('x2')!.status).toBe('under_review')
  })
})

describe('evidence and approval', () => {
  async function readyApplicant() {
    store.addXpert('x1', 'skill_verification')
    const g = await store.createGuarantor({ xpertId: 'x1', name: 'G', contact: '0240000001', relationship: null, namedAt: null, actorId: null, reason: '' })
    await store.patchGuarantor(g.id, { explainer_sent_at: 'now', callback_outcome: 'yes' })
  }

  it('cannot pass evidence with unticked items or an automatic fail', async () => {
    await readyApplicant()
    const e = await screening.addEvidence(ops, { xpertId: 'x1', taskType: 'Tiling', evidenceType: 'submitted_evidence', link: 'https://x.co/a.jpg' })
    await expect(screening.reviewEvidence(ops, e.id, { outcome: 'pass', ticked: { shows_task: true }, autoFailHits: [] })).rejects.toBeInstanceOf(UnprocessableEntityException)
    await expect(screening.reviewEvidence(ops, e.id, { outcome: 'pass', ticked: passTicks, autoFailHits: ['altered'] })).rejects.toBeInstanceOf(UnprocessableEntityException)
    await screening.reviewEvidence(ops, e.id, { outcome: 'pass', ticked: passTicks, autoFailHits: [] })
    expect(store.evidence[0]!.reviewOutcome).toBe('pass')
  })

  it('a reviewed item cannot be reviewed again', async () => {
    await readyApplicant()
    const e = await screening.addEvidence(ops, { xpertId: 'x1', taskType: 'Tiling', evidenceType: 'submitted_evidence', link: 'https://x.co/a.jpg' })
    await screening.reviewEvidence(ops, e.id, { outcome: 'pass', ticked: passTicks, autoFailHits: [] })
    await expect(screening.reviewEvidence(ops, e.id, { outcome: 'fail', ticked: {}, autoFailHits: [], reason: 'changed my mind' })).rejects.toBeInstanceOf(ConflictException)
  })

  it('approval needs passed evidence, then records who verified', async () => {
    await readyApplicant()
    await expect(xperts.approve(boss, 'x1', { verificationSource: 'direct_beyondx' })).rejects.toBeInstanceOf(UnprocessableEntityException)
    const e = await screening.addEvidence(ops, { xpertId: 'x1', taskType: 'Tiling', evidenceType: 'submitted_evidence', link: 'https://x.co/a.jpg' })
    await screening.reviewEvidence(ops, e.id, { outcome: 'pass', ticked: passTicks, autoFailHits: [] })
    const detail = await xperts.detail('x1', boss)
    expect(detail.screeningComplete).toBe(true)
    await xperts.approve(boss, 'x1', { verificationSource: 'direct_beyondx' })
    const x = store.xperts.get('x1')!
    expect([x.status, x.accountActive, x.verificationSource]).toEqual(['provisional_active', true, 'direct_beyondx'])
  })

  it('a verified certification lifts a provisional Xpert to full', async () => {
    store.addXpert('x1', 'provisional_active', { accountActive: true })
    const e = await screening.addEvidence(ops, { xpertId: 'x1', taskType: 'Electrical', evidenceType: 'certification', link: 'https://x.co/c.pdf' })
    await screening.reviewEvidence(ops, e.id, { outcome: 'pass', ticked: passTicks, autoFailHits: [] })
    expect(store.xperts.get('x1')!.status).toBe('full_active')
  })

  it('the ops team cannot approve', async () => {
    await readyApplicant()
    await expect(xperts.transition(ops, 'x1', { expectedFrom: 'skill_verification', to: 'provisional_active', trigger: 'admin_approved' })).rejects.toBeInstanceOf(ForbiddenException)
  })
})

describe('references', () => {
  it('warns about family and about the guarantor', async () => {
    store.addXpert('x1', 'provisional_active', { accountActive: true })
    await store.createGuarantor({ xpertId: 'x1', name: 'Kofi Mensah', contact: '0241112222', relationship: null, namedAt: null, actorId: null, reason: '' })
    const a = await screening.addReference(ops, { xpertId: 'x1', name: 'Ama', contact: '0249998888', relationship: 'My mother' })
    const b = await screening.addReference(ops, { xpertId: 'x1', name: 'Someone', contact: '+233 24 111 2222', relationship: 'Client' })
    expect(a.warnings.length).toBe(1)
    expect(b.warnings.length).toBe(1)
  })

  it('goes unreachable only after the set number of missed calls', async () => {
    store.addXpert('x1', 'provisional_active', { accountActive: true })
    const r = await screening.addReference(ops, { xpertId: 'x1', name: 'Ama Boateng', contact: '0249998888', relationship: 'Client' })
    for (let i = 0; i < 2; i++) await screening.logReferenceCall(ops, r.id, { result: 'not_reached' })
    expect(store.references[0]!.outcome).toBe('pending')
    await screening.logReferenceCall(ops, r.id, { result: 'not_reached' })
    expect(store.references[0]!.outcome).toBe('unreachable')
    await expect(screening.logReferenceCall(ops, r.id, { result: 'confirmed' })).rejects.toBeInstanceOf(ConflictException)
  })

  it('a clean confirmed reference promotes; one with a warning does not', async () => {
    store.addXpert('x1', 'provisional_active', { accountActive: true })
    store.addXpert('x2', 'provisional_active', { accountActive: true })
    const ok = await screening.addReference(ops, { xpertId: 'x1', name: 'Ama Boateng', contact: '0249998888', relationship: 'Client' })
    const bad = await screening.addReference(ops, { xpertId: 'x2', name: 'Esi', contact: '0247776666', relationship: 'My sister' })
    await screening.logReferenceCall(ops, ok.id, { result: 'confirmed' })
    await screening.logReferenceCall(ops, bad.id, { result: 'confirmed' })
    expect(store.xperts.get('x1')!.status).toBe('full_active')
    expect(store.xperts.get('x2')!.status).toBe('provisional_active')
  })
})

describe('sweeps', () => {
  it('closes a guarantor pending application after the deadline but not before', async () => {
    store.addXpert('old', 'guarantor_pending')
    store.addXpert('new', 'guarantor_pending')
    const day = 86_400_000
    await store.createGuarantor({ xpertId: 'old', name: 'G', contact: '0240000001', relationship: null, namedAt: new Date(Date.now() - 15 * day).toISOString(), actorId: null, reason: '' })
    await store.createGuarantor({ xpertId: 'new', name: 'G', contact: '0240000002', relationship: null, namedAt: new Date(Date.now() - 3 * day).toISOString(), actorId: null, reason: '' })
    const r = await sweeps.run()
    expect(r.closedAtDeadline).toBe(1)
    expect(store.xperts.get('old')!.status).toBe('blocked_closed')
    expect(store.xperts.get('new')!.status).toBe('guarantor_pending')
  })

  it('copies guarantor details from the application and starts the clock', async () => {
    store.addXpert('x1', 'applied')
    store.legacy['x1'] = { name: 'Kofi', contact: '0241112222', relationship: 'Boss', namedAt: null }
    const r = await sweeps.run()
    expect(r.guarantorsImported).toBe(1)
    expect(store.xperts.get('x1')!.status).toBe('guarantor_pending')
    expect((await sweeps.run()).guarantorsImported).toBe(0)
  })
})

describe('settings', () => {
  it('refuses a value of the wrong shape and accepts a good one', async () => {
    const config = new ConfigService(store)
    await expect(config.set(boss, 'screening.referenceUnreachableAttempts', 'three', 'x')).rejects.toBeInstanceOf(BadRequestException)
    await config.set(boss, 'screening.referenceUnreachableAttempts', 2, 'Agreed in the ops meeting')
    expect((await config.screening()).config.referenceUnreachableAttempts).toBe(2)
  })

  it('uses a starter checklist until a real one is set, and says so', async () => {
    const config = new ConfigService(store)
    expect((await config.checklistFor('Tiling')).isStarter).toBe(true)
    await config.set(boss, 'screening.evidenceChecklists', { Tiling: { items: [{ id: 'a', label: 'Straight lines' }], autoFail: [] } }, 'Set up')
    const c = await config.checklistFor('Tiling')
    expect(c.isStarter).toBe(false)
    expect(c.checklist.items[0]!.id).toBe('a')
  })
})
