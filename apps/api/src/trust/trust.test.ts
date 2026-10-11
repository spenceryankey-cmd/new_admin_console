import 'reflect-metadata'
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common'
import { DEFAULT_ROLE_PERMISSIONS, can, isCleanJob, reviewTriggerFor, type Permission, type Role } from '@beyondx/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import type { StaffContext } from '../auth/staff-context'
import { FakeJobStore } from '../jobs/fake.job.store'
import { JobsService } from '../jobs/jobs.service'
import { FakeRequestStore } from '../requests/fake.request.store'
import { RequestsService } from '../requests/requests.service'
import { ConfigService } from '../xperts/config.service'
import { FakeStore } from '../xperts/fake.store'
import { XpertsService } from '../xperts/xperts.service'
import { FakeTrustStore } from './fake.trust.store'
import { TrustService } from './trust.service'

const staff = (role: Role, id: string = role): StaffContext => ({ userId: id, email: `${role}@x.co`, fullName: role, role, isActive: true, permissions: new Set<Permission>(DEFAULT_ROLE_PERMISSIONS[role]) })
const ops = staff('ops_reviewer')
const dm = staff('decision_maker')
const fin = staff('finance_approver')

let xstore: FakeStore, rstore: FakeRequestStore, jstore: FakeJobStore, tstore: FakeTrustStore
let jobs: JobsService, reqs: RequestsService, trust: TrustService, xperts: XpertsService

beforeEach(() => {
  xstore = new FakeStore()
  rstore = new FakeRequestStore()
  jstore = new FakeJobStore(rstore)
  tstore = new FakeTrustStore(jstore, xstore)
  const config = new ConfigService(xstore)
  jobs = new JobsService(jstore, xstore, config)
  reqs = new RequestsService(rstore, xstore, config)
  xperts = new XpertsService(xstore, config)
  trust = new TrustService(tstore, xstore, xperts)
  xstore.addXpert('t1', 'provisional_active', { fullName: 'Yaw Tiler', homeArea: 'Madina', skills: ['Tiling'], accountActive: true })
  xstore.addXpert('t2', 'full_active', { fullName: 'Kofi Tiler', homeArea: 'Madina', skills: ['Tiling'], accountActive: true })
})

async function completedJob(xpertId = 't1') {
  const r = await reqs.create(ops, { employerName: 'Mr Adu', employerPhone: '0244000000', category: 'Tiling', description: 'Tile a floor', location: 'Madina', timing: 'Monday', photos: [] })
  await reqs.compose(ops, r.id, { lines: [{ description: 'Labour', amountGhs: 500 }], totalGhs: 500 })
  await reqs.send(ops, r.id)
  await reqs.respond(ops, r.id, { response: 'accepted' })
  await reqs.markPaid(fin, r.id, { momoReference: `MP${Math.random().toString(36).slice(2, 8)}`, method: 'momo' })
  const job = [...jstore.jobs.values()].find((j) => j.requestId === r.id)!
  await jobs.dispatch(ops, job.id, xpertId)
  await jobs.start(ops, job.id)
  await jobs.confirm(ops, job.id, 'employer')
  await jobs.confirm(ops, job.id, 'xpert')
  return job.id
}

describe('rules', () => {
  it('a clean job needs a good rating, not late, and no upheld flag', () => {
    const ok = { completed: true, employerRating: 4, onTime: true, upheldFlags: 0 }
    expect(isCleanJob(ok)).toBe(true)
    expect(isCleanJob({ ...ok, employerRating: 3 })).toBe(false)
    expect(isCleanJob({ ...ok, employerRating: null })).toBe(false)
    expect(isCleanJob({ ...ok, onTime: false })).toBe(false)
    expect(isCleanJob({ ...ok, onTime: null })).toBe(true)
    expect(isCleanJob({ ...ok, upheldFlags: 1 })).toBe(false)
    expect(isCleanJob({ ...ok, completed: false })).toBe(false)
  })
  it('picks the right review trigger', () => {
    expect(reviewTriggerFor('safety')).toBe('safety_concern')
    expect(reviewTriggerFor('no_show')).toBe('no_shows')
    expect(reviewTriggerFor('quality')).toBe('flag_named_incident')
  })
  it('flags are raised by ops and decided by decision makers', () => {
    expect(can(ops, 'flags.raise')).toBe(true)
    expect(can(ops, 'flags.decide')).toBe(false)
    expect(can(dm, 'flags.decide')).toBe(true)
    expect(can(fin, 'flags.raise')).toBe(false)
  })
})

describe('clean jobs lift a provisional Xpert', () => {
  it('stays provisional with no feedback, then becomes fully active once the employer rates the job well', async () => {
    const id = await completedJob()
    await xperts.afterScreeningEvent('t1')
    expect((await xstore.getXpert('t1'))!.status).toBe('provisional_active')
    await trust.logFeedback(ops, { jobId: id, side: 'employer', rating: 5, onTime: true, wouldRepeat: true })
    expect((await xstore.getXpert('t1'))!.status).toBe('full_active')
    expect((await trust.reliability('t1')).cleanJobs).toBe(1)
  })
  it('a poor rating does not lift them', async () => {
    const id = await completedJob()
    await trust.logFeedback(ops, { jobId: id, side: 'employer', rating: 2, onTime: true, wouldRepeat: false })
    expect((await xstore.getXpert('t1'))!.status).toBe('provisional_active')
  })
  it('an Xpert side rating does not count towards clean jobs', async () => {
    const id = await completedJob()
    await trust.logFeedback(ops, { jobId: id, side: 'xpert', rating: 5, onTime: null, wouldRepeat: null })
    expect((await xstore.getXpert('t1'))!.status).toBe('provisional_active')
  })
  it('refuses feedback before completion and a second copy from the same side', async () => {
    const id = await completedJob()
    await trust.logFeedback(ops, { jobId: id, side: 'employer', rating: 5, onTime: true, wouldRepeat: null })
    await expect(trust.logFeedback(ops, { jobId: id, side: 'employer', rating: 4, onTime: true, wouldRepeat: null })).rejects.toBeInstanceOf(ConflictException)
  })
})

describe('flags', () => {
  it('runs open, investigating, decided, and closes counter flags', async () => {
    const id = await completedJob('t2')
    const raised = await trust.raise(ops, { xpertId: 't2', jobId: id, raisedBy: 'employer', category: 'quality', detail: 'Left a mess behind' })
    const fid = raised.flag.id
    const withCounter = await trust.counter(ops, fid, { raisedBy: 'xpert', detail: 'The mess was already there' })
    expect(withCounter.counters).toHaveLength(1)
    expect((await trust.investigate(dm, fid)).flag.status).toBe('investigating')
    const decided = await trust.decide(dm, fid, { outcome: 'upheld', note: 'Photos confirm it', sendToReview: false })
    expect(decided.flag.status).toBe('upheld')
    expect(decided.counters[0]!.status).toBe('reviewed')
    expect(decided.reliability.flagsUpheld).toBe(1)
    await expect(trust.decide(dm, fid, { outcome: 'dismissed', note: 'changed my mind', sendToReview: false })).rejects.toBeInstanceOf(ConflictException)
    await expect(trust.counter(ops, fid, { raisedBy: 'xpert', detail: 'Too late to add this' })).rejects.toBeInstanceOf(ConflictException)
  })
  it('an upheld flag makes that job unclean', async () => {
    const id = await completedJob('t2')
    await trust.logFeedback(ops, { jobId: id, side: 'employer', rating: 5, onTime: true, wouldRepeat: null })
    expect((await trust.reliability('t2')).cleanJobs).toBe(1)
    const f = await trust.raise(ops, { xpertId: 't2', jobId: id, raisedBy: 'employer', category: 'conduct', detail: 'Rude to the family' })
    await trust.decide(dm, f.flag.id, { outcome: 'upheld', note: 'Confirmed by two people', sendToReview: false })
    expect((await trust.reliability('t2')).cleanJobs).toBe(0)
  })
  it('can send an Xpert to Under Review when upheld, if the role allows it', async () => {
    const f = await trust.raise(ops, { xpertId: 't2', raisedBy: 'staff', category: 'safety', detail: 'Left a ladder unsafe' })
    await trust.decide(dm, f.flag.id, { outcome: 'upheld', note: 'Serious enough to review', sendToReview: true })
    expect((await xstore.getXpert('t2'))!.status).toBe('under_review')
    const g = await trust.raise(ops, { xpertId: 't1', raisedBy: 'staff', category: 'no_show', detail: 'Did not turn up' })
    await expect(trust.decide(staff('super_admin'), g.flag.id, { outcome: 'dismissed', note: 'Employer cancelled', sendToReview: true })).rejects.toBeInstanceOf(BadRequestException)
  })
  it('refuses a flag on an unknown Xpert or job', async () => {
    await expect(trust.raise(ops, { xpertId: 'nope', raisedBy: 'staff', category: 'other', detail: 'Something odd' })).rejects.toBeInstanceOf(BadRequestException)
    await expect(trust.raise(ops, { xpertId: 't1', jobId: '00000000-0000-4000-8000-000000000000', raisedBy: 'staff', category: 'other', detail: 'Something odd' })).rejects.toBeInstanceOf(BadRequestException)
  })
  it('only a role that can change status may send to review', async () => {
    const custom = { ...dm, permissions: new Set<Permission>(['flags.decide']) } as StaffContext
    const f = await trust.raise(ops, { xpertId: 't2', raisedBy: 'staff', category: 'conduct', detail: 'Rude on the phone' })
    await expect(trust.decide(custom, f.flag.id, { outcome: 'upheld', note: 'Confirmed', sendToReview: true })).rejects.toBeInstanceOf(ForbiddenException)
  })
})

describe('coordinators', () => {
  it('computes metrics from the roster records and moves an Xpert between coordinators', async () => {
    const a = await trust.createCoordinator(dm, { fullName: 'Coordinator A' })
    const b = await trust.createCoordinator(dm, { fullName: 'Coordinator B' })
    const id = await completedJob('t2')
    await trust.logFeedback(ops, { jobId: id, side: 'employer', rating: 4, onTime: true, wouldRepeat: null })
    await trust.assign(dm, a.id, 't2', 'Vouched for by A')
    await trust.assign(dm, a.id, 't1', 'Vouched for by A')
    let d = await trust.coordinatorDetail(a.id)
    expect(d.metrics).toMatchObject({ xperts: 2, activeXperts: 2, jobsCompleted: 1, cleanJobs: 1, avgRating: 4 })
    await trust.assign(dm, b.id, 't2', 'Moved to B')
    d = await trust.coordinatorDetail(a.id)
    expect(d.metrics.xperts).toBe(1)
    expect((await trust.coordinatorDetail(b.id)).roster[0]!.xpertId).toBe('t2')
  })
  it('refuses an inactive coordinator and an unknown Xpert', async () => {
    const a = await trust.createCoordinator(dm, { fullName: 'Coordinator A' })
    await expect(trust.assign(dm, a.id, 'nope', 'x y z')).rejects.toBeInstanceOf(BadRequestException)
    await trust.setCoordinatorActive(dm, a.id, false, 'Left the team')
    await expect(trust.assign(dm, a.id, 't1', 'x y z')).rejects.toBeInstanceOf(ConflictException)
  })
})
