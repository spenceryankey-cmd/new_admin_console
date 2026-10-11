import 'reflect-metadata'
import { ConflictException, UnprocessableEntityException } from '@nestjs/common'
import { DEFAULT_MONITOR_CONFIG, DEFAULT_ROLE_PERMISSIONS, can, canReplace, jobMove, matchXpert, watchJob, type Permission, type Role } from '@beyondx/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import type { StaffContext } from '../auth/staff-context'
import { FakeRequestStore } from '../requests/fake.request.store'
import { RequestsService } from '../requests/requests.service'
import { ConfigService } from '../xperts/config.service'
import { FakeStore } from '../xperts/fake.store'
import { FakeJobStore } from './fake.job.store'
import { JobsService } from './jobs.service'

const staff = (role: Role, id: string = role): StaffContext => ({ userId: id, email: `${role}@x.co`, fullName: role, role, isActive: true, permissions: new Set<Permission>(DEFAULT_ROLE_PERMISSIONS[role]) })
const ops = staff('ops_reviewer')
const fin = staff('finance_approver')

let xstore: FakeStore
let rstore: FakeRequestStore
let jstore: FakeJobStore
let jobs: JobsService
let reqs: RequestsService

beforeEach(() => {
  xstore = new FakeStore()
  rstore = new FakeRequestStore()
  jstore = new FakeJobStore(rstore)
  const config = new ConfigService(xstore)
  jobs = new JobsService(jstore, xstore, config)
  reqs = new RequestsService(rstore, xstore, config)
  xstore.addXpert('t1', 'full_active', { fullName: 'Yaw Tiler', homeArea: 'Madina', skills: ['Tiling'], accountActive: true })
  xstore.addXpert('t2', 'provisional_active', { fullName: 'Kofi Tiler', homeArea: 'Tema', skills: ['Tiling'], accountActive: true })
  xstore.addXpert('c1', 'full_active', { fullName: 'Esi Cleaner', homeArea: 'Madina', skills: ['Cleaning'], accountActive: true })
  xstore.addXpert('t3', 'suspended', { fullName: 'Suspended Tiler', homeArea: 'Madina', skills: ['Tiling'], accountActive: false })
})

async function paidJob() {
  const r = await reqs.create(ops, { employerName: 'Mr Adu', employerPhone: '0244000000', category: 'Tiling', description: 'Tile a floor', location: 'Madina', timing: 'Monday', photos: [] })
  await reqs.compose(ops, r.id, { lines: [{ description: 'Labour', amountGhs: 500 }], totalGhs: 500 })
  await reqs.send(ops, r.id)
  await reqs.respond(ops, r.id, { response: 'accepted' })
  await reqs.markPaid(fin, r.id, { momoReference: `MP${Math.random().toString(36).slice(2, 8)}`, method: 'momo' })
  const { jobs: list } = await jobs.list({ limit: 30, offset: 0 })
  return list[0]!
}

describe('rules', () => {
  it('allows only the listed job moves', () => {
    expect(jobMove('awaiting_dispatch', 'dispatched')).not.toBeNull()
    expect(jobMove('awaiting_dispatch', 'in_progress')).toBeNull()
    expect(jobMove('completed', 'cancelled')).toBeNull()
    expect(canReplace('in_progress')).toBe(true)
    expect(canReplace('awaiting_dispatch')).toBe(false)
  })
  it('matches on skill, status and activity, and ranks by fit', () => {
    const base = { job: { category: 'Tiling', location: 'Madina', amountGhs: 500 }, band: { minGhs: 400, maxGhs: 600 }, activeJobs: 0 }
    const x = (o: object) => ({ id: 'a', fullName: 'A', status: 'full_active', accountActive: true, homeArea: 'Madina', skills: ['Tiling'], ...o })
    expect(matchXpert({ ...base, xpert: x({ skills: ['Cleaning'] }) })).toBeNull()
    expect(matchXpert({ ...base, xpert: x({ status: 'suspended' }) })).toBeNull()
    expect(matchXpert({ ...base, xpert: x({ accountActive: false }) })).toBeNull()
    const good = matchXpert({ ...base, xpert: x({}) })!
    const busy = matchXpert({ ...base, xpert: x({}), activeJobs: 3 })!
    const far = matchXpert({ ...base, xpert: x({ homeArea: 'Tema' }) })!
    expect(good.price).toBe('within')
    expect(good.score).toBeGreaterThan(busy.score)
    expect(good.score).toBeGreaterThan(far.score)
    expect(matchXpert({ ...base, band: null, xpert: x({}) })!.price).toBe('no_band')
  })
  it('flags a job that has not started or is waiting on one confirmation', () => {
    const now = new Date('2026-01-10T12:00:00Z')
    const old = new Date('2026-01-08T00:00:00Z').toISOString()
    expect(watchJob({ status: 'dispatched', dispatchedAt: old, employerConfirmedAt: null, xpertConfirmedAt: null }, now, DEFAULT_MONITOR_CONFIG)?.kind).toBe('start_overdue')
    expect(watchJob({ status: 'in_progress', dispatchedAt: old, employerConfirmedAt: old, xpertConfirmedAt: null }, now, DEFAULT_MONITOR_CONFIG)?.kind).toBe('confirmation_overdue')
    expect(watchJob({ status: 'in_progress', dispatchedAt: old, employerConfirmedAt: null, xpertConfirmedAt: null }, now, DEFAULT_MONITOR_CONFIG)).toBeNull()
  })
  it('finance can watch jobs but not dispatch them', () => {
    expect(can(fin, 'jobs.monitor')).toBe(true)
    expect(can(fin, 'dispatch.match')).toBe(false)
    expect(can(ops, 'jobs.replace')).toBe(true)
  })
})

describe('job life', () => {
  it('a job appears when the payment is recorded, not before', async () => {
    const r = await reqs.create(ops, { employerName: 'E', employerPhone: '0244000000', category: 'Tiling', description: 'Tile a floor', location: 'Madina', timing: 'Monday', photos: [] })
    await reqs.compose(ops, r.id, { lines: [{ description: 'Labour', amountGhs: 500 }], totalGhs: 500 })
    await reqs.send(ops, r.id)
    await reqs.respond(ops, r.id, { response: 'accepted' })
    expect((await jobs.list({ limit: 30, offset: 0 })).total).toBe(0)
    await reqs.markPaid(fin, r.id, { momoReference: 'MP12345', method: 'momo' })
    expect((await jobs.list({ limit: 30, offset: 0 })).total).toBe(1)
  })

  it('lists matches, excluding people who cannot take the job', async () => {
    const j = await paidJob()
    const d = await jobs.detail(j.id)
    expect(d.matches.map((m) => m.xpertId)).toEqual(['t1', 't2'])
    expect(d.matches[0]!.sameArea).toBe(true)
  })

  it('refuses to dispatch someone without the skill or not active', async () => {
    const j = await paidJob()
    await expect(jobs.dispatch(ops, j.id, 'c1')).rejects.toBeInstanceOf(UnprocessableEntityException)
    await expect(jobs.dispatch(ops, j.id, 't3')).rejects.toBeInstanceOf(UnprocessableEntityException)
  })

  it('dispatches, starts, replaces with a reason, and completes only when both sides confirm', async () => {
    const j = await paidJob()
    await jobs.dispatch(ops, j.id, 't1')
    await expect(jobs.dispatch(ops, j.id, 't2')).rejects.toBeInstanceOf(ConflictException)
    await expect(jobs.confirm(ops, j.id, 'employer')).rejects.toBeInstanceOf(ConflictException)
    await jobs.start(ops, j.id)
    const replaced = await jobs.replace(ops, j.id, 't2', 'First Xpert stopped answering')
    expect(replaced.job.xpertId).toBe('t2')
    expect(replaced.assignments.map((a) => a.status).sort()).toEqual(['active', 'replaced'])
    await expect(jobs.replace(ops, j.id, 't2', 'again')).rejects.toBeInstanceOf(ConflictException)

    const one = await jobs.confirm(ops, j.id, 'employer')
    expect(one.job.status).toBe('in_progress')
    expect(one.paymentStatus).toBe('received')
    const both = await jobs.confirm(ops, j.id, 'xpert')
    expect(both.job.status).toBe('completed')
    expect(both.paymentStatus).toBe('released')
    expect(both.assignments.find((a) => a.status === 'completed')?.xpertId).toBe('t2')
    await expect(jobs.cancel(ops, j.id, 'too late')).rejects.toBeInstanceOf(ConflictException)
  })

  it('a replacement clears the old Xpert confirmation', async () => {
    const j = await paidJob()
    await jobs.dispatch(ops, j.id, 't1')
    await jobs.start(ops, j.id)
    await jobs.confirm(ops, j.id, 'xpert')
    const after = await jobs.replace(ops, j.id, 't2', 'Swapped for distance')
    expect(after.job.xpertConfirmedAt).toBeNull()
  })

  it('cancelling leaves the payment as received for finance to decide', async () => {
    const j = await paidJob()
    await jobs.dispatch(ops, j.id, 't1')
    const d = await jobs.cancel(ops, j.id, 'Employer changed their mind')
    expect(d.job.status).toBe('cancelled')
    expect(d.paymentStatus).toBe('received')
    expect(d.assignments[0]!.status).toBe('withdrawn')
  })
})

describe('change orders', () => {
  it('needs an Xpert on the job, then both confirmations', async () => {
    const j = await paidJob()
    await expect(jobs.logChangeOrder(ops, { jobId: j.id, description: 'Extra room', amountDeltaGhs: 100 })).rejects.toBeInstanceOf(ConflictException)
    await jobs.dispatch(ops, j.id, 't1')
    const { id } = await jobs.logChangeOrder(ops, { jobId: j.id, description: 'Extra room', amountDeltaGhs: 100 })
    expect((await jobs.confirmChange(ops, id, 'employer')).status).toBe('logged')
    expect((await jobs.confirmChange(ops, id, 'xpert')).status).toBe('confirmed')
    await expect(jobs.rejectChange(ops, id, 'xpert', 'no')).rejects.toBeInstanceOf(ConflictException)
  })
  it('one rejection ends it', async () => {
    const j = await paidJob()
    await jobs.dispatch(ops, j.id, 't1')
    const { id } = await jobs.logChangeOrder(ops, { jobId: j.id, description: 'Extra room', amountDeltaGhs: 0 })
    const r = await jobs.rejectChange(ops, id, 'employer', 'Too expensive')
    expect(r.status).toBe('rejected')
    expect(r.rejectedBy).toBe('employer')
  })
})

describe('recurring services', () => {
  const body = { employerName: 'Mrs Ofori', employerPhone: '0244000000', category: 'Cleaning', description: 'Weekly clean', location: 'East Legon', timing: 'Mondays', frequency: 'weekly' as const }
  it('generates a request when due, moves the date, and does nothing the second time', async () => {
    const today = new Date().toISOString().slice(0, 10)
    const s = await jobs.createRecurring(ops, { ...body, nextDue: today })
    expect((await jobs.counts()).recurringDue).toBe(1)
    expect(await jobs.generateDue()).toBe(1)
    expect(await jobs.generateDue()).toBe(0)
    expect((await reqs.list({ limit: 30, offset: 0 })).total).toBe(1)
    const after = (await jobs.recurring())[0]!
    expect(after.nextDue > today).toBe(true)
    expect(s.id).toBe(after.id)
  })
  it('a paused service generates nothing', async () => {
    const today = new Date().toISOString().slice(0, 10)
    const s = await jobs.createRecurring(ops, { ...body, nextDue: today })
    await jobs.setRecurring(ops, s.id, false, 'Employer on holiday')
    expect(await jobs.generateDue()).toBe(0)
  })
})
