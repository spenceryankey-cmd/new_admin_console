import { Eye, EyeOff } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { Button } from '../components/ui'
import { supabase } from '../lib/supabase'

export function Login() {
  const { session } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  if (session) return <Navigate to="/" replace />

  async function signIn(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (err) setError('That email and password did not match. Try again.')
    setBusy(false)
  }

  async function forgot() {
    setError(null)
    setNotice(null)
    if (!email.trim()) {
      setError('Enter your email address first.')
      return
    }
    setBusy(true)
    await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/set-password` })
    setBusy(false)
    setNotice('If that email belongs to a staff account, a reset link is on its way.')
  }

  return (
    <div className="grid min-h-full lg:grid-cols-[minmax(0,420px)_1fr]">
      <div className="hidden flex-col justify-between bg-ink-900 p-12 lg:flex">
        <img src="/beyondx-logo-light.png" alt="BeyondX" className="h-7 w-auto self-start" />
        <div>
          <h1 className="text-4xl font-semibold leading-tight text-ink-50">Operations, one queue at a time.</h1>
          <p className="mt-4 max-w-sm text-ink-300">Screen Xperts, quote requests, dispatch and monitor jobs. For BeyondX staff only.</p>
        </div>
        <p className="text-xs text-ink-400">Every action in this console is recorded.</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={signIn} className="w-full max-w-sm space-y-5" aria-label="Sign in">
          <img src="/beyondx-logo-light.png" alt="BeyondX" className="mb-2 h-6 w-auto lg:hidden" />
          <div>
            <h2 className="text-2xl font-semibold text-ink-50">Sign in</h2>
            <p className="mt-1 text-sm text-ink-300">Use the email address your invitation was sent to.</p>
          </div>
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" type="email" autoComplete="username" required className="field" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <div className="relative">
              <input id="password" type={show ? 'text' : 'password'} autoComplete="current-password" required className="field pr-11" value={password} onChange={(e) => setPassword(e.target.value)} />
              <button type="button" onClick={() => setShow((s) => !s)} className="absolute inset-y-0 right-0 px-3 text-ink-300 hover:text-ink-50" aria-label={show ? 'Hide password' : 'Show password'}>
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          {error && <p role="alert" className="text-sm text-danger-400">{error}</p>}
          {notice && <p role="status" className="text-sm text-forest-300">{notice}</p>}
          <Button type="submit" busy={busy} className="w-full">Sign in</Button>
          <button type="button" onClick={() => void forgot()} className="w-full text-center text-sm text-ink-300 underline-offset-4 hover:text-ink-50 hover:underline">
            Forgot your password
          </button>
        </form>
      </div>
    </div>
  )
}
