import 'reflect-metadata'
import { BadRequestException, ConflictException, UnprocessableEntityException } from '@nestjs/common'
import { DEFAULT_MONITOR_CONFIG, DEFAULT_ROLE_PERMISSIONS, can, canReplace, dispatchSchema, jobMove, matchXpert, pairProblem, watchJob, type Permission, type Role } from '@beyondx/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import type { StaffContext } from '../auth/staff-context'
import { FakeRequestStore } from '../requests/fake.request.store'
import { RequestsService } from '../requests/requests.service'
import { ConfigService } from '../xperts/config.service'
import { FakeStore } from '../xperts/fake.store'
import { XpertsService } from '../xperts/xperts.service'
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
  jobs = new JobsService(jstore, xstore, config, new XpertsService(xstore, config))
  reqs = new RequestsService(rstore, xstore, config)
  xstore.addXpert('t1', 'full_active', { fullName: 'Yaw Tiler', homeArea: 'Madina', skills: ['Skilled Trades'], accountActive: true })
  xstore.addXpert('t2', 'provisional_active', { fullName: 'Kofi Tiler', homeArea: 'Tema', skills: ['Skilled Trades'], accountActive: true })
  xstore.addXpert('c1', 'full_active', { fullName: 'Esi Cleaner', homeArea: 'Madina', skills: ['Facility & Cleaning'], accountActive: true })
  xstore.addXpert('t4', 'provisional_active', { fullName: 'Ama Backup', homeArea: 'Kumasi', skills: ['Skilled Trades'], accountActive: true })
  xstore.addXpert('t5', 'provisional_active', { fullName: 'Efua Backup', homeArea: 'Kumasi', skills: ['Skilled Trades'], accountActive: true })
  xstore.addXpert('t3', 'suspended', { fullName: 'Suspended Tiler', homeArea: 'Madina', skills: ['Skilled Trades'], accountActive: false })
})

async function paidJob() {
  const r = await reqs.create(ops, { employerName: 'Mr Adu', employerPhone: '0244000000', category: 'Skilled Trades', description: 'Tile a floor', location: 'Madina', timing: 'Monday', photos: [] })
  await reqs.compose(ops, r.id, { lines: [{ description: 'Labour', amountGhs: 500 }], totalGhs: 500 })
  await reqs.send(ops, r.id)
  await reqs.respond(ops, r.id, { response: 'accepted' })
  await reqs.markPaid(fin, r.id, { momoReference: `MP${Math.random().toString(36).slice(2, 8)}`, method: 'momo' })
  const { jobs: list } = await jobs.list({ limit: 30, offset: 0 })
  return list[0]!
}

async function paidJob2() {
  const r = await reqs.create(ops, { employerName: 'Mrs Ofori', employerPhone: '0244000001', category: 'Skilled Trades', description: 'Tile a wall', location: 'Madina', timing: 'Tuesday', photos: [] })
  await reqs.compose(ops, r.id, { lines: [{ description: 'Labour', amountGhs: 300 }], totalGhs: 300 })
  await reqs.send(ops, r.id)
  await reqs.respond(ops, r.id, { response: 'accepted' })
  await reqs.markPaid(fin, r.id, { momoReference: `MQ${Math.random().toString(36).slice(2, 8)}`, method: 'momo' })
  return (await jobs.list({ limit: 30, offset: 0 })).jobs.find((j) => j.requestId === r.id)!
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
    const base = { job: { category: 'Skilled Trades', location: 'Madina', amountGhs: 500 }, band: { minGhs: 400, maxGhs: 600 }, activeJobs: 0 }
    const x = (o: object) => ({ id: 'a', fullName: 'A', status: 'full_active', accountActive: true, homeArea: 'Madina', skills: ['Skilled Trades'], ...o })
    expect(matchXpert({ ...base, xpert: x({ skills: ['Facility & Cleaning'] }) })).toBeNull()
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
    expect(watchJob({ status: 'in_progress', dispatchedAt: old, employerConfirmedAt: null, xpertConfirmedAt: null, backupXpertId: 'b' }, now, DEFAULT_MONITOR_CONFIG)).toBeNull()
  })
  it('finance can watch jobs but not dispatch them', () => {
    expect(can(fin, 'jobs.monitor')).toBe(true)
    expect(can(fin, 'dispatch.match')).toBe(false)
    expect(can(ops, 'jobs.replace')).toBe(true)
  })
})

describe('job life', () => {
  it('a job appears when the payment is recorded, not before', async () => {
    const r = await reqs.create(ops, { employerName: 'E', employerPhone: '0244000000', category: 'Skilled Trades', description: 'Tile a floor', location: 'Madina', timing: 'Monday', photos: [] })
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
    expect(d.matches.map((m) => m.xpertId).sort()).toEqual(['t1', 't2', 't4', 't5'])
    expect(d.matches[0]!.xpertId).toBe('t1')
    expect(d.matches[0]!.sameArea).toBe(true)
  })

  it('refuses to dispatch someone without the skill or not active', async () => {
    const j = await paidJob()
    await expect(jobs.dispatch(ops, j.id, 'c1', 't4')).rejects.toBeInstanceOf(UnprocessableEntityException)
    await expect(jobs.dispatch(ops, j.id, 't3', 't4')).rejects.toBeInstanceOf(UnprocessableEntityException)
  })

  it('dispatches, starts, replaces with a reason, and completes only when both sides confirm', async () => {
    const j = await paidJob()
    await jobs.dispatch(ops, j.id, 't1', 't4')
    await expect(jobs.dispatch(ops, j.id, 't2', 't4')).rejects.toBeInstanceOf(ConflictException)
    await expect(jobs.confirm(ops, j.id, 'employer')).rejects.toBeInstanceOf(ConflictException)
    await jobs.start(ops, j.id)
    const replaced = await jobs.replace(ops, j.id, 't2', 'First Xpert stopped answering')
    expect(replaced.job.xpertId).toBe('t2')
    expect(replaced.assignments.map((a) => a.status).sort()).toEqual(['active', 'active', 'replaced'])
    await expect(jobs.replace(ops, j.id, 't2', 'again')).rejects.toBeInstanceOf(ConflictException)

    const one = await jobs.confirm(ops, j.id, 'employer')
    expect(one.job.status).toBe('in_progress')
    expect(one.paymentStatus).toBe('received')
    const both = await jobs.confirm(ops, j.id, 'xpert')
    expect(both.job.status).toBe('completed')
    expect(both.paymentStatus).toBe('released')
    expect(both.assignments.find((a) => a.status === 'completed')?.xpertId).toBe('t2')
    expect(both.assignments.find((a) => a.role === 'backup')?.status).toBe('withdrawn')
    await expect(jobs.cancel(ops, j.id, 'too late')).rejects.toBeInstanceOf(ConflictException)
  })

  it('a replacement clears the old Xpert confirmation', async () => {
    const j = await paidJob()
    await jobs.dispatch(ops, j.id, 't1', 't4')
    await jobs.start(ops, j.id)
    await jobs.confirm(ops, j.id, 'xpert')
    const after = await jobs.replace(ops, j.id, 't2', 'Swapped for distance')
    expect(after.job.xpertConfirmedAt).toBeNull()
  })

  it('cancelling leaves the payment as received for finance to decide', async () => {
    const j = await paidJob()
    await jobs.dispatch(ops, j.id, 't1', 't4')
    const d = await jobs.cancel(ops, j.id, 'Employer changed their mind')
    expect(d.job.status).toBe('cancelled')
    expect(d.paymentStatus).toBe('received')
    expect(d.assignments.every((a) => a.status === 'withdrawn')).toBe(true)
  })
})

describe('primary and backup', () => {
  it('rules: the pair must be two different Xperts, both present', () => {
    expect(pairProblem('a', null)).toMatch(/backup/)
    expect(pairProblem('a', '  ')).toMatch(/backup/)
    expect(pairProblem('a', 'a')).toMatch(/different/)
    expect(pairProblem('a', 'b')).toBeNull()
    expect(dispatchSchema.safeParse({ xpertId: 'a' }).success).toBe(false)
    expect(dispatchSchema.safeParse({ xpertId: 'a', backupXpertId: 'a' }).success).toBe(false)
    expect(dispatchSchema.safeParse({ xpertId: 'a', backupXpertId: 'b' }).success).toBe(true)
  })
  it('flags a live job that has no backup', () => {
    const now = new Date()
    const base = { dispatchedAt: now.toISOString(), employerConfirmedAt: null, xpertConfirmedAt: null }
    expect(watchJob({ ...base, status: 'dispatched', backupXpertId: null }, now, DEFAULT_MONITOR_CONFIG)?.kind).toBe('backup_needed')
    expect(watchJob({ ...base, status: 'dispatched', backupXpertId: 'b' }, now, DEFAULT_MONITOR_CONFIG)).toBeNull()
    expect(watchJob({ ...base, status: 'awaiting_dispatch', backupXpertId: null }, now, DEFAULT_MONITOR_CONFIG)).toBeNull()
  })
  it('refuses to dispatch with no backup, the same Xpert twice, or an unfit backup', async () => {
    const j = await paidJob()
    await expect(jobs.dispatch(ops, j.id, 't1', '')).rejects.toBeInstanceOf(BadRequestException)
    await expect(jobs.dispatch(ops, j.id, 't1', 't1')).rejects.toBeInstanceOf(BadRequestException)
    await expect(jobs.dispatch(ops, j.id, 't1', 't3')).rejects.toBeInstanceOf(UnprocessableEntityException)
    await expect(jobs.dispatch(ops, j.id, 't1', 'c1')).rejects.toBeInstanceOf(UnprocessableEntityException)
    expect((await jobs.detail(j.id)).job.status).toBe('awaiting_dispatch')
  })
  it('dispatch records both, and the backup is not offered as a match or counted as workload', async () => {
    const j = await paidJob()
    const d = await jobs.dispatch(ops, j.id, 't1', 't4')
    expect(d.job.xpertId).toBe('t1')
    expect(d.job.backupXpertId).toBe('t4')
    expect(d.job.backupXpertName).toBe('Ama Backup')
    expect(d.assignments.map((a) => `${a.role}:${a.xpertId}`).sort()).toEqual(['backup:t4', 'primary:t1'])
    expect(d.matches.map((m) => m.xpertId).sort()).toEqual(['t2', 't5'])
    expect((await jstore.activeLoad(['t1', 't4'])).get('t4')).toBeUndefined()
  })
  it('replace cannot use the backup, and leaves the backup in place', async () => {
    const j = await paidJob()
    await jobs.dispatch(ops, j.id, 't1', 't4')
    await expect(jobs.replace(ops, j.id, 't4', 'swap')).rejects.toBeInstanceOf(ConflictException)
    const r = await jobs.replace(ops, j.id, 't2', 'First Xpert unwell')
    expect(r.job.xpertId).toBe('t2')
    expect(r.job.backupXpertId).toBe('t4')
  })
  it('Promote backup needs a reason, keeps the history, and leaves the job needing a backup', async () => {
    const j = await paidJob()
    await jobs.dispatch(ops, j.id, 't1', 't4')
    await jobs.start(ops, j.id)
    await jobs.confirm(ops, j.id, 'xpert')
    const d = await jobs.promoteBackup(ops, j.id, 'Primary unwell')
    expect(d.job.xpertId).toBe('t4')
    expect(d.job.backupXpertId).toBeNull()
    expect(d.job.xpertConfirmedAt).toBeNull()
    expect(d.job.status).toBe('in_progress')
    expect(d.job.watch?.kind).toBe('backup_needed')
    expect(d.assignments.find((a) => a.xpertId === 't1')?.status).toBe('replaced')
    expect(d.assignments.find((a) => a.xpertId === 't4')?.role).toBe('primary')
    await expect(jobs.promoteBackup(ops, j.id, 'again')).rejects.toBeInstanceOf(ConflictException)
    const withBackup = await jobs.setBackup(ops, j.id, 't5', undefined)
    expect(withBackup.job.backupXpertId).toBe('t5')
    expect(withBackup.job.watch).toBeNull()
    await expect(jobs.setBackup(ops, j.id, 't2', undefined)).rejects.toBeInstanceOf(BadRequestException)
    await expect(jobs.setBackup(ops, j.id, 't4', 'x y z')).rejects.toBeInstanceOf(ConflictException)
  })
  it('only roles with the permission can promote or record a no show', () => {
    expect(can(ops, 'dispatch.promote')).toBe(true)
    expect(can(staff('decision_maker'), 'dispatch.promote')).toBe(true)
    expect(can(fin, 'dispatch.promote')).toBe(false)
  })
})

describe('no show', () => {
  it('promotes the backup and counts the no show', async () => {
    const j = await paidJob()
    await jobs.dispatch(ops, j.id, 't1', 't4')
    const d = await jobs.noShow(ops, j.id, 'Did not answer')
    expect(d.noShow).toMatchObject({ promotedXpertId: 't4', noShowXpertId: 't1', noShowsInWindow: 1, limit: 2, sentToReview: false })
    expect(d.job.xpertId).toBe('t4')
    expect(d.assignments.find((a) => a.xpertId === 't1')?.status).toBe('no_show')
    expect((await xstore.getXpert('t1'))?.status).toBe('full_active')
  })
  it('the second no show inside the window sends the Xpert to Under Review', async () => {
    const a = await paidJob()
    await jobs.dispatch(ops, a.id, 't1', 't4')
    await jobs.noShow(ops, a.id, undefined)
    const b = await paidJob2()
    await jobs.dispatch(ops, b.id, 't1', 't5')
    const d = await jobs.noShow(ops, b.id, undefined)
    expect(d.noShow).toMatchObject({ noShowsInWindow: 2, sentToReview: true })
    expect((await xstore.getXpert('t1'))?.status).toBe('under_review')
  })
  it('a no show outside the window does not count', async () => {
    const a = await paidJob()
    await jobs.dispatch(ops, a.id, 't1', 't4')
    await jobs.noShow(ops, a.id, undefined)
    for (const x of jstore.assignments) if (x.status === 'no_show') x.endedAt = new Date(Date.now() - 60 * 86_400_000).toISOString()
    const b = await paidJob2()
    await jobs.dispatch(ops, b.id, 't1', 't5')
    const d = await jobs.noShow(ops, b.id, undefined)
    expect(d.noShow).toMatchObject({ noShowsInWindow: 1, sentToReview: false })
    expect((await xstore.getXpert('t1'))?.status).toBe('full_active')
  })
  it('with no backup left the job goes back to Needs an Xpert', async () => {
    const j = await paidJob()
    await jobs.dispatch(ops, j.id, 't1', 't4')
    await jobs.noShow(ops, j.id, undefined)
    const d = await jobs.noShow(ops, j.id, undefined)
    expect(d.job.status).toBe('awaiting_dispatch')
    expect(d.job.xpertId).toBeNull()
    expect(d.noShow.promotedXpertId).toBeNull()
    await expect(jobs.noShow(ops, j.id, undefined)).rejects.toBeInstanceOf(ConflictException)
    const again = await jobs.dispatch(ops, j.id, 't2', 't5')
    expect(again.job.status).toBe('dispatched')
  })
  it('the sweep repairs a review that was missed', async () => {
    const a = await paidJob()
    await jobs.dispatch(ops, a.id, 't1', 't4')
    await jobs.noShow(ops, a.id, undefined)
    const b = await paidJob2()
    await jobs.dispatch(ops, b.id, 't1', 't5')
    xstore.failNextTransition = true
    const d = await jobs.noShow(ops, b.id, undefined)
    expect(d.noShow.sentToReview).toBe(false)
    expect((await xstore.getXpert('t1'))?.status).toBe('full_active')
    expect(await jobs.reviewNoShows()).toBe(1)
    expect((await xstore.getXpert('t1'))?.status).toBe('under_review')
    expect(await jobs.reviewNoShows()).toBe(0)
  })
})

describe('change orders', () => {
  it('needs an Xpert on the job, then both confirmations', async () => {
    const j = await paidJob()
    await expect(jobs.logChangeOrder(ops, { jobId: j.id, description: 'Extra room', amountDeltaGhs: 100 })).rejects.toBeInstanceOf(ConflictException)
    await jobs.dispatch(ops, j.id, 't1', 't4')
    const { id } = await jobs.logChangeOrder(ops, { jobId: j.id, description: 'Extra room', amountDeltaGhs: 100 })
    expect((await jobs.confirmChange(ops, id, 'employer')).status).toBe('logged')
    expect((await jobs.confirmChange(ops, id, 'xpert')).status).toBe('confirmed')
    await expect(jobs.rejectChange(ops, id, 'xpert', 'no')).rejects.toBeInstanceOf(ConflictException)
  })
  it('one rejection ends it', async () => {
    const j = await paidJob()
    await jobs.dispatch(ops, j.id, 't1', 't4')
    const { id } = await jobs.logChangeOrder(ops, { jobId: j.id, description: 'Extra room', amountDeltaGhs: 0 })
    const r = await jobs.rejectChange(ops, id, 'employer', 'Too expensive')
    expect(r.status).toBe('rejected')
    expect(r.rejectedBy).toBe('employer')
  })
})

describe('recurring services', () => {
  const body = { employerName: 'Mrs Ofori', employerPhone: '0244000000', category: 'Facility & Cleaning', description: 'Weekly clean', location: 'East Legon', timing: 'Mondays', frequency: 'weekly' as const }
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
