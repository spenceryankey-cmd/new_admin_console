import 'reflect-metadata'
import { BadRequestException, ConflictException, HttpException, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { beforeEach, describe, expect, it } from 'vitest'
import { NOTIFICATION_SENDS_PER_HOUR, inboxListQuerySchema, sendNotificationSchema, type RawInboxMessage } from '@beyondx/shared'
import { FakeInboxSource, FakeInboxStore, FakeNotificationSink } from './fake.inbox'
import { InboxService } from './inbox.service'
import { NotConnectedInboxSource, NotConnectedNotificationSink } from './inbox.ports'
import { NotificationsService } from './notifications.service'
import type { StaffContext } from '../auth/staff-context'

const actor = { userId: 'u1', email: 'ops@beyondxco.com', fullName: 'Test Staff', role: 'ops_reviewer', isActive: true, permissions: new Set() } as StaffContext
const msg = (ref: string, over: Partial<RawInboxMessage> = {}): RawInboxMessage => ({ ref, type: 'report', name: 'Ama', phone: '0244000001', body: 'Something happened', createdAt: '2026-10-01T10:00:00Z', ...over })

function setup(messages: RawInboxMessage[]) {
  const source = new FakeInboxSource(messages)
  const store = new FakeInboxStore()
  const audits: any[] = []
  const audit = { record: async (_a: unknown, e: unknown) => void audits.push(e) } as never
  return { source, store, audits, svc: new InboxService(source, store, audit), audit }
}
const q = (over: Record<string, unknown> = {}) => inboxListQuerySchema.parse(over)

describe('support inbox', () => {
  let t: ReturnType<typeof setup>
  beforeEach(() => {
    t = setup([
      msg('a', { createdAt: '2026-10-01T10:00:00Z', name: 'Kofi', phone: '0244111222', body: 'Cannot log in' }),
      msg('b', { createdAt: '2026-10-03T10:00:00Z', name: 'Esi', type: 'new_xpert', body: 'Heard about you from a friend' }),
      msg('c', { createdAt: '2026-10-02T10:00:00Z', name: 'Yaw', body: 'Late arrival' }),
    ])
  })

  it('shows what needs attention first by default, newest first', async () => {
    const r = await t.svc.list(q())
    expect(r.messages.map((m) => m.ref)).toEqual(['b', 'c', 'a'])
    expect(r.total).toBe(3)
    expect(r.messages.every((m) => m.status === 'open')).toBe(true)
  })

  it('moves a message to Handled with who, when and a note, and keeps the original text untouched', async () => {
    const done = await t.svc.handle(actor, 'c', { status: 'handled', note: 'Called the employer', reason: 'Dealt with by phone' })
    expect(done.status).toBe('handled')
    expect(done.note).toBe('Called the employer')
    expect(done.handledByName).toBe('Test Staff')
    expect(done.handledAt).toBeTruthy()
    expect(done.body).toBe('Late arrival')
    expect((await t.svc.list(q())).messages.map((m) => m.ref)).toEqual(['b', 'a'])
    expect((await t.svc.list(q({ status: 'handled' }))).messages.map((m) => m.ref)).toEqual(['c'])
    expect((await t.svc.list(q({ status: 'all' }))).total).toBe(3)
    expect(await t.svc.counts()).toEqual({ open: 2, handled: 1, total: 3 })
    expect(t.audits[0]).toMatchObject({ action: 'inbox.handled', entityType: 'inbox_state', entityId: 'c', reason: 'Dealt with by phone' })
  })

  it('can reopen a message, which clears who handled it', async () => {
    await t.svc.handle(actor, 'a', { status: 'handled', reason: 'Done' })
    const again = await t.svc.handle(actor, 'a', { status: 'open', reason: 'It came back' })
    expect(again.status).toBe('open')
    expect(again.handledByName).toBeNull()
    expect(again.handledAt).toBeNull()
    expect(t.audits.map((a) => a.action)).toEqual(['inbox.handled', 'inbox.reopened'])
  })

  it('refuses a message that does not exist, and changes nothing', async () => {
    await expect(t.svc.handle(actor, 'nope', { status: 'handled', reason: 'Done' })).rejects.toBeInstanceOf(NotFoundException)
    expect(t.store.state.size).toBe(0)
    expect(t.audits).toHaveLength(0)
  })

  it('searches by name, phone, type and text, ignoring case', async () => {
    expect((await t.svc.list(q({ status: 'all', q: 'kofi' }))).messages.map((m) => m.ref)).toEqual(['a'])
    expect((await t.svc.list(q({ status: 'all', q: '0244111' }))).messages.map((m) => m.ref)).toEqual(['a'])
    expect((await t.svc.list(q({ status: 'all', q: 'NEW_XPERT' }))).messages.map((m) => m.ref)).toEqual(['b'])
    expect((await t.svc.list(q({ status: 'all', q: 'late' }))).messages.map((m) => m.ref)).toEqual(['c'])
    expect((await t.svc.list(q({ status: 'all', q: 'zzz' }))).total).toBe(0)
  })

  it('pages the list and reports the full total', async () => {
    const r = await t.svc.list(q({ status: 'all', limit: 2, offset: 1 }))
    expect(r.messages.map((m) => m.ref)).toEqual(['c', 'a'])
    expect(r.total).toBe(3)
  })

  it('handles a message with missing name and phone', async () => {
    t.source.messages.push(msg('d', { name: null, phone: null }))
    const r = await t.svc.list(q({ status: 'all', q: 'happened' }))
    expect(r.messages.find((m) => m.ref === 'd')).toMatchObject({ name: null, phone: null })
  })

  it('is refused plainly, not shown as empty, until the main site is connected', async () => {
    const svc = new InboxService(new NotConnectedInboxSource(), t.store, t.audit)
    await expect(svc.list(q())).rejects.toBeInstanceOf(ServiceUnavailableException)
    await expect(svc.counts()).rejects.toBeInstanceOf(ServiceUnavailableException)
  })
})

describe('sending notifications', () => {
  const xperts = [
    { id: 'x1', name: 'Kofi', categories: ['Skilled Trades'] },
    { id: 'x2', name: 'Esi', categories: ['Skilled Trades', 'Painting & Finishing'] },
    { id: 'x3', name: 'Yaw', categories: ['Facility & Cleaning'] },
  ]
  const employers = [{ id: 'e1', name: 'Mr Adu' }]
  let sink: FakeNotificationSink, store: FakeInboxStore, svc: NotificationsService, audits: any[], clock: number

  beforeEach(() => {
    sink = new FakeNotificationSink(xperts, employers)
    store = new FakeInboxStore()
    audits = []
    svc = new NotificationsService(sink, store, { record: async (_a: unknown, e: unknown) => void audits.push(e) } as never)
    clock = 1_000_000
    svc.now = () => clock
  })
  const send = (audience: any, body = 'Rain is expected tomorrow. Check your jobs.', confirmRecipients = 1) => svc.send(actor, sendNotificationSchema.parse({ audience, body, confirmRecipients }))

  it('previews how many people a group is, with a few names, before anything is sent', async () => {
    expect(await svc.preview({ kind: 'all_xperts' })).toEqual({ recipients: 3, sample: ['Kofi', 'Esi', 'Yaw'] })
    expect((await svc.preview({ kind: 'xperts_in_category', category: 'Skilled Trades' })).recipients).toBe(2)
    expect((await svc.preview({ kind: 'xperts_in_category', category: 'Event & Hospitality' })).recipients).toBe(0)
    expect(sink.delivered).toHaveLength(0)
  })

  it('sends to a category and records the exact text, the count, and who sent it', async () => {
    const r = await send({ kind: 'xperts_in_category', category: 'Skilled Trades' }, '  Rain is expected tomorrow.  ', 2)
    expect(r).toMatchObject({ status: 'sent', recipientCount: 2, deliveredCount: 2, body: 'Rain is expected tomorrow.', audienceKind: 'xperts_in_category', audienceDetail: 'Skilled Trades', sentByName: 'Test Staff' })
    expect(sink.delivered).toHaveLength(1)
    expect(sink.delivered[0]!.to.map((p) => p.id)).toEqual(['x1', 'x2'])
    expect(audits[0]).toMatchObject({ action: 'notification.sent', entityType: 'notification_send', entityId: r.id, reason: 'Xperts in Skilled Trades' })
    expect(audits[0].metadata).toMatchObject({ body: 'Rain is expected tomorrow.', recipients: 2, delivered: 2, status: 'sent' })
  })

  it('sends to one employer and to one Xpert', async () => {
    expect((await send({ kind: 'employer', id: 'e1' })).audienceDetail).toBe('e1')
    expect((await send({ kind: 'xpert', id: 'x3' })).recipientCount).toBe(1)
  })

  it('sends nothing when the number of people changed since it was confirmed', async () => {
    await expect(send({ kind: 'all_xperts' }, 'Hello everyone', 2)).rejects.toBeInstanceOf(ConflictException)
    expect(sink.delivered).toHaveLength(0)
    expect(store.sends).toHaveLength(0)
  })

  it('sends nothing when no one matches', async () => {
    await expect(send({ kind: 'xpert', id: 'ghost' })).rejects.toBeInstanceOf(BadRequestException)
    await expect(send({ kind: 'xperts_in_category', category: 'Event & Hospitality' })).rejects.toBeInstanceOf(BadRequestException)
    expect(sink.delivered).toHaveLength(0)
  })

  it('records a failed delivery as failed and tells the person', async () => {
    sink.failNext = true
    await expect(send({ kind: 'employer', id: 'e1' })).rejects.toBeInstanceOf(ServiceUnavailableException)
    expect(store.sends[0]).toMatchObject({ status: 'failed', deliveredCount: 0, recipientCount: 1 })
    expect(store.sends[0]!.error).toContain('did not answer')
    expect(audits[0].metadata.status).toBe('failed')
  })

  it('records a partial delivery as partial', async () => {
    sink.deliverOnly = 2
    const r = await send({ kind: 'all_xperts' }, 'Hello everyone', 3)
    expect(r).toMatchObject({ status: 'partial', recipientCount: 3, deliveredCount: 2 })
    expect(r.error).toBeTruthy()
  })

  it('limits how many sends one person can make in an hour, and frees up after the hour', async () => {
    for (let i = 0; i < NOTIFICATION_SENDS_PER_HOUR; i++) await send({ kind: 'employer', id: 'e1' })
    const e = await send({ kind: 'employer', id: 'e1' }).catch((x) => x)
    expect(e).toBeInstanceOf(HttpException)
    expect((e as HttpException).getStatus()).toBe(429)
    clock += 3_600_001
    await expect(send({ kind: 'employer', id: 'e1' })).resolves.toMatchObject({ status: 'sent' })
  })

  it('counts the limit per person, not for everyone together', async () => {
    for (let i = 0; i < NOTIFICATION_SENDS_PER_HOUR; i++) await send({ kind: 'employer', id: 'e1' })
    const other = { ...actor, userId: 'u2' } as StaffContext
    await expect(svc.send(other, sendNotificationSchema.parse({ audience: { kind: 'employer', id: 'e1' }, body: 'Hello', confirmRecipients: 1 }))).resolves.toMatchObject({ status: 'sent' })
  })

  it('lists what was sent, newest first', async () => {
    await send({ kind: 'employer', id: 'e1' }, 'First message')
    await send({ kind: 'xpert', id: 'x1' }, 'Second message')
    const h = await svc.history({ limit: 10, offset: 0 })
    expect(h.sends.map((s) => s.body)).toEqual(['Second message', 'First message'])
    expect(h.total).toBe(2)
  })

  it('is refused plainly until the main site is connected', async () => {
    const off = new NotificationsService(new NotConnectedNotificationSink(), store, { record: async () => undefined } as never)
    await expect(off.preview({ kind: 'all_xperts' })).rejects.toBeInstanceOf(ServiceUnavailableException)
    await expect(off.send(actor, sendNotificationSchema.parse({ audience: { kind: 'all_xperts' }, body: 'Hello', confirmRecipients: 1 }))).rejects.toBeInstanceOf(ServiceUnavailableException)
    expect(store.sends).toHaveLength(0)
  })
})

describe('what is accepted', () => {
  it('rejects a message that is empty or too long, and a category that is not on the list', () => {
    const base = { audience: { kind: 'all_xperts' }, confirmRecipients: 1 }
    expect(sendNotificationSchema.safeParse({ ...base, body: '  ' }).success).toBe(false)
    expect(sendNotificationSchema.safeParse({ ...base, body: 'x'.repeat(501) }).success).toBe(false)
    expect(sendNotificationSchema.safeParse({ ...base, body: 'x'.repeat(500) }).success).toBe(true)
    expect(sendNotificationSchema.safeParse({ audience: { kind: 'xperts_in_category', category: 'Remote Support' }, body: 'Hello', confirmRecipients: 1 }).success).toBe(false)
    expect(sendNotificationSchema.safeParse({ audience: { kind: 'everyone' }, body: 'Hello', confirmRecipients: 1 }).success).toBe(false)
    expect(sendNotificationSchema.safeParse({ ...base, body: 'Hello', confirmRecipients: 0 }).success).toBe(false)
  })
})
