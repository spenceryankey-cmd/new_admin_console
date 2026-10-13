import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mfa, refreshSession } = vi.hoisted(() => ({
  mfa: { listFactors: vi.fn(), unenroll: vi.fn(), enroll: vi.fn(), challengeAndVerify: vi.fn() },
  refreshSession: vi.fn(),
}))
vi.mock('../lib/supabase', () => ({ supabase: { auth: { mfa, refreshSession } }, configError: null }))

import { MfaGate } from './MfaGate'

const noFactors = { data: { totp: [], all: [] }, error: null }
const oneFactor = { data: { totp: [{ id: 'f1', status: 'verified', factor_type: 'totp' }], all: [{ id: 'f1', status: 'verified', factor_type: 'totp' }] }, error: null }

function setup() {
  const onDone = vi.fn().mockResolvedValue(undefined)
  const onSignOut = vi.fn()
  render(<MfaGate email="ama@beyondxco.com" onDone={onDone} onSignOut={onSignOut} />)
  return { onDone, onSignOut, user: userEvent.setup() }
}

beforeEach(() => {
  vi.resetAllMocks()
  refreshSession.mockResolvedValue({ data: {}, error: null })
  mfa.unenroll.mockResolvedValue({ data: {}, error: null })
})

describe('MfaGate', () => {
  it('asks for the code when an authenticator app is already set up, without enrolling again', async () => {
    mfa.listFactors.mockResolvedValue(oneFactor)
    setup()
    expect(await screen.findByRole('heading', { name: 'Enter your code' })).toBeInTheDocument()
    expect(mfa.enroll).not.toHaveBeenCalled()
  })

  it('first time: shows the QR code and the key, then confirms with a code', async () => {
    mfa.listFactors.mockResolvedValue(noFactors)
    mfa.enroll.mockResolvedValue({ data: { id: 'f9', totp: { qr_code: 'data:image/svg+xml;utf8,<svg/>', secret: 'ABCD EFGH', uri: 'otpauth://x' } }, error: null })
    mfa.challengeAndVerify.mockResolvedValue({ data: {}, error: null })
    const { user, onDone } = setup()
    expect(await screen.findByRole('heading', { name: 'Set up your authenticator app' })).toBeInTheDocument()
    expect(screen.getByAltText('Authenticator app set up code')).toBeInTheDocument()
    expect(screen.getByText('ABCD EFGH')).toBeInTheDocument()
    await user.type(screen.getByLabelText('6 digit code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Confirm and continue' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'f9', code: '123456' })
    expect(refreshSession).toHaveBeenCalled()
  })

  it('clears a half finished set up before starting a new one', async () => {
    mfa.listFactors.mockResolvedValue({ data: { totp: [], all: [{ id: 'old', status: 'unverified', factor_type: 'totp' }] }, error: null })
    mfa.enroll.mockResolvedValue({ data: { id: 'f9', totp: { qr_code: 'x', secret: 'S', uri: 'u' } }, error: null })
    setup()
    await screen.findByText('S')
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: 'old' })
  })

  it('does not call the server for a code that is not six digits', async () => {
    mfa.listFactors.mockResolvedValue(oneFactor)
    const { user } = setup()
    await user.type(await screen.findByLabelText('6 digit code'), '12ab3')
    expect(screen.getByLabelText('6 digit code')).toHaveValue('123')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter the 6 digit code from your app.')
    expect(mfa.challengeAndVerify).not.toHaveBeenCalled()
  })

  it('keeps the person on the screen with a plain message when the code is wrong', async () => {
    mfa.listFactors.mockResolvedValue(oneFactor)
    mfa.challengeAndVerify.mockResolvedValue({ data: null, error: { message: 'Invalid TOTP code entered' } })
    const { user, onDone } = setup()
    await user.type(await screen.findByLabelText('6 digit code'), '000000')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That code did not work')
    expect(screen.getByLabelText('6 digit code')).toHaveValue('')
    expect(onDone).not.toHaveBeenCalled()
    expect(refreshSession).not.toHaveBeenCalled()
  })

  it('offers a retry when the factors cannot be loaded, and a way to sign out', async () => {
    mfa.listFactors.mockResolvedValueOnce({ data: null, error: { message: 'down' } }).mockResolvedValue(oneFactor)
    const { user, onSignOut } = setup()
    expect(await screen.findByText(/Could not check your authenticator app/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /try again|retry/i }))
    expect(await screen.findByRole('heading', { name: 'Enter your code' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(onSignOut).toHaveBeenCalled()
  })
})
