import 'reflect-metadata'
import { BadRequestException, ConflictException, UnprocessableEntityException } from '@nestjs/common'
import { DEFAULT_ROLE_PERMISSIONS, can, quoteProblems, requestMove, type Permission, type Role } from '@beyondx/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import type { StaffContext } from '../auth/staff-context'
import { ConfigService } from '../xperts/config.service'
import { FakeStore } from '../xperts/fake.store'
import { FakeRequestStore } from './fake.request.store'
import { RequestsService } from './requests.service'

const staff = (role: Role): StaffContext => ({ userId: role, email: `${role}@x.co`, fullName: role, role, isActive: true, permissions: new Set<Permission>(DEFAULT_ROLE_PERMISSIONS[role]) })
const ops = staff('ops_reviewer')

let store: FakeRequestStore
let svc: RequestsService
let xstore: FakeStore

const input = { employerName: 'Mr Adu', employerPhone: '0244000000', category: 'Skilled Trades', description: 'Tile a kitchen floor', location: 'Madina', timing: 'Next week', photos: [] }
const quoteBody = { lines: [{ description: 'Labour', amountGhs: 400 }, { description: 'Materials', amountGhs: 150.5 }], totalGhs: 550.5 }

beforeEach(() => {
  store = new FakeRequestStore()
  xstore = new FakeStore()
  svc = new RequestsService(store, xstore, new ConfigService(xstore))
})

async function sentRequest() {
  const { id } = await svc.create(ops, input)
  await svc.compose(ops, id, quoteBody)
  await svc.send(ops, id)
  return id
}

describe('who can do what', () => {
  it('every role that can see the dashboard can prepare quotes', () => {
    for (const r of ['ops_reviewer', 'decision_maker', 'finance_approver', 'super_admin'] as Role[]) {
      expect(can(staff(r), 'quotes.compose')).toBe(true)
    }
  })
  it('only finance and super admin record payments', () => {
    expect(can(staff('finance_approver'), 'payments.record')).toBe(true)
    expect(can(staff('ops_reviewer'), 'payments.record')).toBe(false)
  })
})

describe('request rules', () => {
  it('allows only the listed moves', () => {
    expect(requestMove('new', 'quoted')).not.toBeNull()
    expect(requestMove('new', 'accepted')).toBeNull()
    expect(requestMove('accepted', 'cancelled')).toBeNull()
    expect(requestMove('declined', 'quoted')).toBeNull()
  })
  it('checks that the lines add up', () => {
    expect(quoteProblems([{ description: 'a', amountGhs: 100.1 }, { description: 'b', amountGhs: 200.2 }], 300.3)).toEqual([])
    expect(quoteProblems([{ description: 'a', amountGhs: 100 }], 120)).toContain('The lines do not add up to the total.')
    expect(quoteProblems([], 10)).toContain('Add at least one line.')
  })
})

describe('quoting', () => {
  it('rejects a quote whose lines do not add up', async () => {
    const { id } = await svc.create(ops, input)
    await expect(svc.compose(ops, id, { lines: [{ description: 'Labour', amountGhs: 100 }], totalGhs: 150 })).rejects.toBeInstanceOf(UnprocessableEntityException)
  })

  it('a draft can be edited, then sent with a three day validity', async () => {
    const { id } = await svc.create(ops, input)
    await svc.compose(ops, id, quoteBody)
    await svc.compose(ops, id, { lines: [{ description: 'All in', amountGhs: 600 }], totalGhs: 600 })
    expect(store.quotes).toHaveLength(1)
    const d = await svc.send(ops, id)
    expect(d.request.status).toBe('quoted')
    const q = d.quotes[0]!
    const days = (new Date(q.validUntil!).getTime() - new Date(q.sentAt!).getTime()) / 86_400_000
    expect(days).toBeCloseTo(3, 1)
  })

  it('cannot send with nothing prepared, and cannot edit once sent', async () => {
    const { id } = await svc.create(ops, input)
    await expect(svc.send(ops, id)).rejects.toBeInstanceOf(ConflictException)
    await svc.compose(ops, id, quoteBody)
    await svc.send(ops, id)
    await expect(svc.compose(ops, id, quoteBody)).rejects.toBeInstanceOf(ConflictException)
  })

  it('withdrawing returns the request to new and the next quote is version 2', async () => {
    const id = await sentRequest()
    const d = await svc.withdraw(ops, id, 'Price was wrong')
    expect(d.request.status).toBe('new')
    await svc.compose(ops, id, quoteBody)
    expect((await svc.detail(id)).quotes.map((q) => q.version)).toEqual([2, 1])
  })

  it('an accepted quote creates a pending payment', async () => {
    const id = await sentRequest()
    const d = await svc.respond(ops, id, { response: 'accepted', note: 'Called, said yes' })
    expect(d.request.status).toBe('accepted')
    expect(d.payment).toMatchObject({ status: 'pending', amountGhs: 550.5, method: 'momo' })
    await expect(svc.respond(ops, id, { response: 'declined' })).rejects.toBeInstanceOf(ConflictException)
  })

  it('a declined quote closes the request', async () => {
    const id = await sentRequest()
    const d = await svc.respond(ops, id, { response: 'declined' })
    expect(d.request.status).toBe('declined')
    expect(d.payment).toBeNull()
  })

  it('an expired quote cannot be answered, and the sweep expires it', async () => {
    const id = await sentRequest()
    store.quotes[0]!.validUntil = new Date(Date.now() - 1000).toISOString()
    await expect(svc.respond(ops, id, { response: 'accepted' })).rejects.toBeInstanceOf(ConflictException)
    expect(await svc.expireDue()).toBe(1)
    expect((await svc.detail(id)).request.status).toBe('expired')
    expect(await svc.expireDue()).toBe(0)
  })

  it('cancelling a quoted request withdraws the quote', async () => {
    const id = await sentRequest()
    const d = await svc.cancel(ops, id, 'Employer found someone else')
    expect(d.request.status).toBe('cancelled')
    expect(d.quotes[0]!.status).toBe('withdrawn')
  })

  it('an accepted request cannot be cancelled here', async () => {
    const id = await sentRequest()
    await svc.respond(ops, id, { response: 'accepted' })
    await expect(svc.cancel(ops, id, 'Changed mind')).rejects.toBeInstanceOf(UnprocessableEntityException)
  })
})

describe('payment', () => {
  it('records a MoMo reference once, and refuses the same reference twice', async () => {
    const a = await sentRequest()
    const b = await sentRequest()
    await svc.respond(ops, a, { response: 'accepted' })
    await svc.respond(ops, b, { response: 'accepted' })
    const fin = staff('finance_approver')
    const d = await svc.markPaid(fin, a, { momoReference: 'MP240101', method: 'momo' })
    expect(d.status).toBe('received')
    await expect(svc.markPaid(fin, a, { momoReference: 'MP999999', method: 'momo' })).rejects.toBeInstanceOf(ConflictException)
    await expect(svc.markPaid(fin, b, { momoReference: 'mp240101', method: 'momo' })).rejects.toBeInstanceOf(ConflictException)
  })
  it('there is nothing to record before acceptance', async () => {
    const id = await sentRequest()
    await expect(svc.markPaid(staff('finance_approver'), id, { momoReference: 'MP1234', method: 'momo' })).rejects.toThrow()
  })
})

describe('pricing', () => {
  it('a new benchmark replaces the live one and keeps the old', async () => {
    await svc.saveBenchmark(ops, { category: 'Skilled Trades', unit: 'per_job', amountGhs: 500, reason: 'First rate' })
    await svc.saveBenchmark(ops, { category: 'Skilled Trades', unit: 'per_job', amountGhs: 550, reason: 'Prices went up' })
    const all = await svc.benchmarks()
    expect(all.filter((r) => r.active)).toHaveLength(1)
    expect(all).toHaveLength(2)
  })
  it('refuses a band for an Xpert that does not exist, and a band that is upside down', async () => {
    await expect(svc.saveBand(ops, { xpertId: 'nope', category: 'Skilled Trades', minGhs: 100, maxGhs: 200, reason: 'Set' })).rejects.toBeInstanceOf(BadRequestException)
    xstore.addXpert('x1', 'full_active')
    const b = await svc.saveBand(ops, { xpertId: 'x1', category: 'Skilled Trades', minGhs: 100, maxGhs: 200, reason: 'Set' })
    expect(b.xpertName).toBe('Xpert x1')
    await expect(svc.patchBand(ops, b.id, { maxGhs: 50 }, 'Oops')).rejects.toBeInstanceOf(UnprocessableEntityException)
  })
})
