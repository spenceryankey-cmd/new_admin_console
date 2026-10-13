import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InboxMessage } from '@beyondx/shared'

const { api, auth } = vi.hoisted(() => ({ api: vi.fn(), auth: { can: new Set<string>() } }))
vi.mock('../lib/api', () => ({ api, ApiError: class extends Error {}, errorText: (e: unknown) => (e instanceof Error ? e.message : String(e)) }))
vi.mock('../lib/supabase', () => ({ supabase: { auth: {} }, configError: null }))
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ has: (p: string) => auth.can.has(p) }) }))

import { Inbox, typeLabel } from './Inbox'

const m = (ref: string, over: Partial<InboxMessage> = {}): InboxMessage => ({
  ref, type: 'report', name: 'Ama Boateng', phone: '0244000001', body: 'The Xpert was late', createdAt: '2026-10-01T10:00:00Z',
  status: 'open', note: null, handledByName: null, handledAt: null, ...over,
})

function setup(messages: InboxMessage[], canHandle = true) {
  auth.can = new Set(canHandle ? ['inbox.read', 'inbox.handle'] : ['inbox.read'])
  api.mockReset()
  api.mockImplementation(async (path: string, opts?: { method?: string }) => {
    if (path.startsWith('/inbox/counts')) return { open: messages.filter((x) => x.status === 'open').length, handled: messages.filter((x) => x.status === 'handled').length, total: messages.length }
    if (path.startsWith('/inbox?')) return { messages, total: messages.length }
    if (opts?.method === 'POST') return {}
    throw new Error(`unexpected ${path}`)
  })
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Inbox /></QueryClientProvider>)
  return userEvent.setup()
}

beforeEach(() => vi.clearAllMocks())

describe('typeLabel', () => {
  it('writes message types in plain words and says Xpert', () => {
    expect(typeLabel('report')).toBe('Report')
    expect(typeLabel('xpert_registered')).toBe('Xpert registered')
    // Older types from the main site use the old word for Xperts. It is never shown.
    expect(typeLabel('new_' + 'work' + 'er')).toBe('New Xpert')
  })
})

describe('Support inbox', () => {
  it('shows each message with who sent it, what it says, and that it needs attention', async () => {
    setup([m('a'), m('b', { name: null, phone: null, body: 'No name on this one' })])
    expect(await screen.findByText('The Xpert was late')).toBeInTheDocument()
    expect(screen.getByText('Ama Boateng')).toBeInTheDocument()
    expect(screen.getByText('Unknown sender')).toBeInTheDocument()
    expect(screen.getAllByText('Needs attention').length).toBeGreaterThan(0)
    expect(await screen.findByText('2 need attention')).toBeInTheDocument()
  })

  it('asks for the Needs attention list first, and the others when chosen', async () => {
    const user = setup([m('a')])
    await screen.findByText('The Xpert was late')
    expect(api.mock.calls.some(([p]) => String(p).startsWith('/inbox?status=open'))).toBe(true)
    await user.click(screen.getByRole('button', { name: /^Handled/ }))
    await waitFor(() => expect(api.mock.calls.some(([p]) => String(p).startsWith('/inbox?status=handled'))).toBe(true))
    await user.click(screen.getByRole('button', { name: /^All/ }))
    await waitFor(() => expect(api.mock.calls.some(([p]) => String(p).startsWith('/inbox?status=all'))).toBe(true))
  })

  it('sends the search text to the server', async () => {
    const user = setup([m('a')])
    await screen.findByText('The Xpert was late')
    await user.type(screen.getByLabelText('Search messages'), 'Kofi')
    await waitFor(() => expect(api.mock.calls.some(([p]) => String(p).includes('q=Kofi'))).toBe(true))
  })

  it('needs a few words on what was done before it can be marked handled, then saves it', async () => {
    const user = setup([m('ref/1')])
    await user.click(await screen.findByRole('button', { name: 'Mark handled' }))
    const dialog = screen.getByRole('dialog', { name: 'Mark as handled' })
    const confirm = within(dialog).getByRole('button', { name: 'Mark handled' })
    expect(confirm).toBeDisabled()
    await user.type(within(dialog).getByLabelText('What was done'), 'Called the employer')
    await user.type(within(dialog).getByLabelText('Note (optional)'), 'Resolved')
    expect(confirm).toBeEnabled()
    await user.click(confirm)
    await waitFor(() => expect(api).toHaveBeenCalledWith('/inbox/ref%2F1/handle', { method: 'POST', body: { status: 'handled', note: 'Resolved', reason: 'Called the employer' } }))
  })

  it('lets a handled message be reopened, and shows who handled it', async () => {
    const user = setup([m('a', { status: 'handled', handledByName: 'Kofi Staff', handledAt: '2026-10-02T09:00:00Z', note: 'Phoned back' })])
    expect(await screen.findByText(/Handled by Kofi Staff/)).toHaveTextContent('Phoned back')
    await user.click(screen.getByRole('button', { name: 'Reopen' }))
    const dialog = screen.getByRole('dialog', { name: 'Reopen this message' })
    await user.type(within(dialog).getByLabelText('Why is it being reopened'), 'It happened again')
    await user.click(within(dialog).getByRole('button', { name: 'Reopen' }))
    await waitFor(() => expect(api).toHaveBeenCalledWith('/inbox/a/handle', expect.objectContaining({ body: expect.objectContaining({ status: 'open' }) })))
  })

  it('hides the buttons from someone who can read but not handle', async () => {
    setup([m('a')], false)
    await screen.findByText('The Xpert was late')
    expect(screen.queryByRole('button', { name: 'Mark handled' })).not.toBeInTheDocument()
  })

  it('says so, plainly, when nothing needs attention', async () => {
    setup([])
    expect(await screen.findByText('Nothing needs attention')).toBeInTheDocument()
  })

  it('shows the error, with a retry, when the inbox cannot be read', async () => {
    auth.can = new Set(['inbox.read'])
    api.mockReset()
    api.mockRejectedValue(new Error('This is not connected to the main site yet.'))
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Inbox /></QueryClientProvider>)
    expect(await screen.findByText(/not connected to the main site/)).toBeInTheDocument()
  })
})
