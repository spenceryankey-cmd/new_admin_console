import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { api } = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('../lib/api', () => ({ api, ApiError: class extends Error {}, errorText: (e: unknown) => (e instanceof Error ? e.message : String(e)) }))
vi.mock('../lib/supabase', () => ({ supabase: { auth: {} }, configError: null }))

import { SendNotification } from './SendNotification'

let previewCount = 3
let sendResult: any
let sendError: Error | null

function setup() {
  previewCount = 3
  sendError = null
  sendResult = { id: 's1', status: 'sent', recipientCount: 3, deliveredCount: 3, audienceKind: 'all_xperts', audienceDetail: null, body: 'x', error: null, sentByName: 'Me', createdAt: '2026-10-01T10:00:00Z' }
  api.mockReset()
  api.mockImplementation(async (path: string, opts?: { body?: any }) => {
    if (path.startsWith('/notifications/history')) return { sends: [], total: 0 }
    if (path === '/notifications/preview') return { recipients: previewCount, sample: ['Kofi', 'Esi'] }
    if (path === '/notifications/send') {
      if (sendError) throw sendError
      return sendResult
    }
    throw new Error(`unexpected ${path}`)
  })
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SendNotification /></QueryClientProvider>)
  return userEvent.setup()
}
const sendButton = () => screen.getAllByRole('button').find((b) => /^Send( to \d+ (people|person))?$/.test(b.textContent ?? ''))!

beforeEach(() => vi.clearAllMocks())

describe('Send a notification', () => {
  it('cannot send until the audience has been checked and a message written', async () => {
    const user = setup()
    await screen.findByText('Nothing sent yet')
    expect(sendButton()).toBeDisabled()
    await user.type(screen.getByLabelText('Message'), 'Rain tomorrow, check your jobs')
    expect(sendButton()).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Check who will get it' }))
    expect(await screen.findByRole('status')).toHaveTextContent('This will reach 3 people, including Kofi, Esi.')
    expect(sendButton()).toBeEnabled()
    expect(sendButton()).toHaveTextContent('Send to 3 people')
  })

  it('forgets the count when the audience changes, so a stale number cannot be confirmed', async () => {
    const user = setup()
    await user.type(screen.getByLabelText('Message'), 'Hello everyone')
    await user.click(screen.getByRole('button', { name: 'Check who will get it' }))
    await screen.findByText(/This will reach 3 people/)
    await user.selectOptions(screen.getByLabelText('Who should get it'), 'all_employers')
    expect(screen.queryByText(/This will reach/)).not.toBeInTheDocument()
    expect(sendButton()).toBeDisabled()
  })

  it('needs a category before a category group can be checked, and an id before one person can', async () => {
    const user = setup()
    await user.selectOptions(screen.getByLabelText('Who should get it'), 'xperts_in_category')
    expect(screen.getByRole('button', { name: 'Check who will get it' })).toBeDisabled()
    await user.selectOptions(screen.getByLabelText('Category'), 'Skilled Trades')
    expect(screen.getByRole('button', { name: 'Check who will get it' })).toBeEnabled()
    await user.selectOptions(screen.getByLabelText('Who should get it'), 'xpert')
    expect(screen.getByRole('button', { name: 'Check who will get it' })).toBeDisabled()
    await user.type(screen.getByLabelText('Xpert id'), 'x1')
    expect(screen.getByRole('button', { name: 'Check who will get it' })).toBeEnabled()
  })

  it('says when no one matches, and does not allow a send', async () => {
    const user = setup()
    previewCount = 0
    await user.type(screen.getByLabelText('Message'), 'Hello')
    await user.click(screen.getByRole('button', { name: 'Check who will get it' }))
    expect(await screen.findByText('No one matches that audience.')).toBeInTheDocument()
    expect(sendButton()).toBeDisabled()
  })

  it('shows the exact words and the count in a confirmation, then sends with that count', async () => {
    const user = setup()
    await user.type(screen.getByLabelText('Message'), 'Rain tomorrow, check your jobs')
    await user.click(screen.getByRole('button', { name: 'Check who will get it' }))
    await screen.findByText(/This will reach 3 people/)
    await user.click(sendButton())
    const dialog = screen.getByRole('dialog', { name: 'Send this notification' })
    expect(dialog).toHaveTextContent('3 people')
    expect(within(dialog).getByText('Rain tomorrow, check your jobs')).toBeInTheDocument()
    expect(api).not.toHaveBeenCalledWith('/notifications/send', expect.anything())
    await user.click(within(dialog).getByRole('button', { name: 'Send now' }))
    await waitFor(() => expect(api).toHaveBeenCalledWith('/notifications/send', { method: 'POST', body: { audience: { kind: 'all_xperts' }, body: 'Rain tomorrow, check your jobs', confirmRecipients: 3 } }))
    expect(await screen.findByText('Sent to 3 people.')).toBeInTheDocument()
    expect(screen.getByLabelText('Message')).toHaveValue('')
  })

  it('keeps the dialog open and shows the reason when the send is refused', async () => {
    const user = setup()
    sendError = new Error('The audience changed from 3 to 4 people. Check it and confirm again.')
    await user.type(screen.getByLabelText('Message'), 'Hello everyone')
    await user.click(screen.getByRole('button', { name: 'Check who will get it' }))
    await screen.findByText(/This will reach 3 people/)
    await user.click(sendButton())
    await user.click(screen.getByRole('button', { name: 'Send now' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The audience changed from 3 to 4 people')
    expect(screen.getByRole('dialog', { name: 'Send this notification' })).toBeInTheDocument()
  })

  it('says how many were reached when a send is only partly delivered', async () => {
    const user = setup()
    sendResult = { ...sendResult, status: 'partial', deliveredCount: 2 }
    await user.type(screen.getByLabelText('Message'), 'Hello everyone')
    await user.click(screen.getByRole('button', { name: 'Check who will get it' }))
    await screen.findByText(/This will reach 3 people/)
    await user.click(sendButton())
    await user.click(screen.getByRole('button', { name: 'Send now' }))
    expect(await screen.findByText('Delivered to 2 of 3 people.')).toBeInTheDocument()
  })

  it('counts the characters and stops at the limit', async () => {
    const user = setup()
    await user.type(screen.getByLabelText('Message'), 'Hello')
    expect(screen.getByText('5 of 500 characters')).toBeInTheDocument()
    expect(screen.getByLabelText('Message')).toHaveAttribute('maxlength', '500')
  })
})
