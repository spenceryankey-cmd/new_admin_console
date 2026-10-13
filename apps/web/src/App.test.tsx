import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { MeResponse, Permission } from '@beyondx/shared'

const { auth } = vi.hoisted(() => ({ auth: { current: {} as Record<string, unknown> } }))
vi.mock('./auth/AuthProvider', () => ({ useAuth: () => auth.current, AuthProvider: ({ children }: { children: unknown }) => children }))
vi.mock('./layout/AppShell', async () => {
  const { Outlet: O } = await import('react-router-dom')
  return { AppShell: () => <div data-testid="shell"><O /></div> }
})
vi.mock('./auth/MfaGate', () => ({ MfaGate: () => <div>MFA GATE</div> }))
vi.mock('./lib/supabase', () => ({ supabase: { auth: {} }, configError: null }))
// Pages fetch data. A request that never answers keeps them on their loading state, which is all these tests need.
vi.mock('./lib/api', () => ({ api: () => new Promise(() => undefined), ApiError: class extends Error {}, errorText: (e: unknown) => String(e) }))

import App from './App'

const me = (role: MeResponse['staff']['role'], permissions: Permission[], mfa = { required: false, satisfied: true }): MeResponse => ({
  staff: { userId: 'u1', email: 'a@b.co', fullName: 'A B', role, isActive: true },
  permissions,
  mfa,
})

function state(over: Record<string, unknown>) {
  const m = (over.me ?? null) as MeResponse | null
  const perms = new Set(m?.permissions ?? [])
  auth.current = {
    loading: false, session: { user: { id: 'u1' } }, me: m, denied: null, meError: null,
    retryMe: vi.fn(), reloadMe: vi.fn(), signOut: vi.fn(),
    has: (n: Permission | Permission[]) => (Array.isArray(n) ? n : [n]).every((p) => perms.has(p)),
    hasAny: (n: Permission[]) => n.some((p) => perms.has(p)),
    ...over,
  }
}

const at = (path: string) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}><App /></MemoryRouter>
    </QueryClientProvider>,
  )


describe('sign in gate', () => {
  it('sends a signed out visitor to the sign in page', () => {
    state({ session: null })
    at('/')
    expect(screen.getByRole('form', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByTestId('shell')).not.toBeInTheDocument()
  })

  it('shows a loading state, not the console, while it works out who you are', () => {
    state({ loading: true })
    at('/')
    expect(screen.queryByTestId('shell')).not.toBeInTheDocument()
  })

  it('tells a signed in person who is not staff that they have no access, and offers sign out', () => {
    state({ denied: 'This account is not set up for the admin console' })
    at('/')
    expect(screen.getByText('This account is not set up for the admin console')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    expect(screen.queryByTestId('shell')).not.toBeInTheDocument()
  })

  it('shows the authenticator step, and no console, for a super admin who has not entered a code', () => {
    state({ me: me('super_admin', [], { required: true, satisfied: false }) })
    at('/')
    expect(screen.getByText('MFA GATE')).toBeInTheDocument()
    expect(screen.queryByTestId('shell')).not.toBeInTheDocument()
  })

  it('does the same for a decision maker, on any address', () => {
    state({ me: me('decision_maker', [], { required: true, satisfied: false }) })
    at('/requests')
    expect(screen.getByText('MFA GATE')).toBeInTheDocument()
    expect(screen.queryByTestId('shell')).not.toBeInTheDocument()
  })

  it('opens the console once the code has been entered', () => {
    state({ me: me('super_admin', ['dashboard.view'], { required: true, satisfied: true }) })
    at('/')
    expect(screen.getByTestId('shell')).toBeInTheDocument()
    expect(screen.queryByText('MFA GATE')).not.toBeInTheDocument()
  })

  it('does not ask a role without the requirement for a code', () => {
    state({ me: me('finance_approver', ['payments.record']) })
    at('/')
    expect(screen.getByTestId('shell')).toBeInTheDocument()
    expect(screen.queryByText('MFA GATE')).not.toBeInTheDocument()
  })
})

describe('screens are hidden from roles without the permission', () => {
  it('shows "not available" on a screen the role cannot use', () => {
    state({ me: me('finance_approver', ['payments.record', 'quotes.read']) })
    at('/staff')
    expect(screen.getByText('Not available to your role')).toBeInTheDocument()
  })

  it('does the same for a detail page', () => {
    state({ me: me('finance_approver', ['payments.record']) })
    at('/xperts/x1')
    expect(screen.getByText('Not available to your role')).toBeInTheDocument()
  })

  it('lets a role with the permission through', () => {
    state({ me: me('ops_reviewer', ['xperts.read']) })
    at('/xperts')
    expect(screen.queryByText('Not available to your role')).not.toBeInTheDocument()
  })

  it('answers an unknown address with a not found page, not a blank screen', () => {
    state({ me: me('ops_reviewer', ['xperts.read']) })
    at('/nowhere-at-all')
    expect(screen.queryByText('Not available to your role')).not.toBeInTheDocument()
    expect(screen.getByTestId('shell')).toHaveTextContent(/not found|could not find|does not exist/i)
  })
})
