import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { SERVICE_CATEGORIES } from '@beyondx/shared'

const { api } = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('../lib/api', () => ({ api, ApiError: class extends Error {}, errorText: (e: unknown) => String(e) }))
vi.mock('../lib/supabase', () => ({ supabase: { auth: {} }, configError: null }))

import { CategorySelect } from './catalogue'
import { FeedbackDialog } from './trust'

function Harness() {
  const [v, setV] = useState('')
  return (
    <>
      <label htmlFor="c">Category</label>
      <CategorySelect id="c" value={v} onChange={setV} />
      <output data-testid="picked">{v}</output>
    </>
  )
}

describe('CategorySelect', () => {
  it('offers exactly the ten categories and a prompt, and nothing to type', async () => {
    render(<Harness />)
    const options = within(screen.getByLabelText('Category')).getAllByRole('option')
    expect(options).toHaveLength(11)
    expect(options.slice(1).map((o) => o.textContent)).toEqual(SERVICE_CATEGORIES.map((c) => c.label))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    await userEvent.setup().selectOptions(screen.getByLabelText('Category'), 'Facility & Cleaning')
    expect(screen.getByTestId('picked')).toHaveTextContent('Facility & Cleaning')
  })

  it('has no remote category', () => {
    render(<Harness />)
    expect(screen.queryByRole('option', { name: /remote/i })).not.toBeInTheDocument()
  })
})

describe('FeedbackDialog', () => {
  const open = (category = 'Skilled Trades') => {
    api.mockReset()
    api.mockResolvedValue({})
    const onDone = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    render(<FeedbackDialog jobId="3f6c1c3e-6f0a-4b9a-9f3e-0a1b2c3d4e5f" category={category} onClose={onClose} onDone={onDone} />)
    return { onDone, onClose, user: userEvent.setup() }
  }

  it('lists only the task types of the job category', () => {
    open('Skilled Trades')
    const task = screen.getByLabelText('Task type (optional)')
    const shown = within(task).getAllByRole('option').slice(1).map((o) => o.textContent)
    const expected = SERVICE_CATEGORIES.find((c) => c.label === 'Skilled Trades')!.tasks.map((t) => t.label)
    expect(shown).toEqual(expected)
  })

  it('refuses a rating of 2 or lower with no reason, and says why', async () => {
    const { user, onDone } = open()
    await user.selectOptions(screen.getByLabelText('Rating, 1 to 5'), '2')
    expect(screen.getByText(/choose at least one/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save feedback' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('A rating of 2 or lower needs at least one reason.')
    expect(api).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('saves a low rating once a reason is ticked', async () => {
    const { user, onDone } = open()
    await user.selectOptions(screen.getByLabelText('Rating, 1 to 5'), '1')
    await user.click(screen.getByLabelText('Poor quality of work'))
    await user.click(screen.getByRole('button', { name: 'Save feedback' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(api).toHaveBeenCalledWith('/feedback', expect.objectContaining({ method: 'POST', body: expect.objectContaining({ rating: 1, reasons: ['poor_quality'] }) }))
  })

  it('saves a high rating with no reason', async () => {
    const { user, onDone } = open()
    await user.click(screen.getByRole('button', { name: 'Save feedback' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(api).toHaveBeenCalledWith('/feedback', expect.objectContaining({ body: expect.objectContaining({ rating: 5, reasons: [] }) }))
  })
})
