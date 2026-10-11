import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { Button, Spinner } from '../components/ui'
import { supabase } from '../lib/supabase'

// Landing page for invitation and password reset links. Supabase signs the person
// in from the link, then they choose a password here.
export function SetPassword() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [waited, setWaited] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setWaited(true), 2500)
    return () => clearTimeout(t)
  }, [])

  if (loading || (!session && !waited)) return <Spinner label="Checking your link" />

  if (!session) {
    return (
      <div className="mx-auto max-w-sm p-6 text-center">
        <h1 className="text-xl font-semibold text-ink-50">This link has expired</h1>
        <p className="mt-2 text-sm text-ink-300">Ask a super admin to send a new invitation, or use Forgot your password on the sign in page.</p>
        <Link to="/login" className="mt-4 inline-block text-sm text-forest-300 underline">Go to sign in</Link>
      </div>
    )
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 10) return setError('Use at least 10 characters.')
    if (password !== confirm) return setError('The two passwords do not match.')
    setBusy(true)
    const { error: err } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (err) return setError(err.message)
    navigate('/', { replace: true })
  }

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5" aria-label="Choose a password">
        <img src="/beyondx-logo-light.png" alt="BeyondX" className="h-6 w-auto" />
        <div>
          <h1 className="text-2xl font-semibold text-ink-50">Choose a password</h1>
          <p className="mt-1 text-sm text-ink-300">Signed in as {session.user.email}. You will use this password from now on.</p>
        </div>
        <div>
          <label className="label" htmlFor="pw">New password</label>
          <input id="pw" type="password" autoComplete="new-password" className="field" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="pw2">Confirm password</label>
          <input id="pw2" type="password" autoComplete="new-password" className="field" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        {error && <p role="alert" className="text-sm text-danger-400">{error}</p>}
        <Button type="submit" busy={busy} className="w-full">Save password</Button>
      </form>
    </div>
  )
}
