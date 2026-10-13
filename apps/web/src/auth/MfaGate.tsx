import { useEffect, useState, type FormEvent } from 'react'
import { Button, ErrorState, Spinner } from '../components/ui'
import { supabase } from '../lib/supabase'

type Step =
  | { kind: 'loading' }
  | { kind: 'enter'; factorId: string }
  | { kind: 'enrol'; factorId: string; qr: string; secret: string }
  | { kind: 'failed'; message: string }

const CODE = /^\d{6}$/

/**
 * Shown instead of the console to a role that must use an authenticator app code and has not entered one in this
 * session. First time: scan a QR code and confirm with a code. After that: enter the current code.
 * The API refuses every other route until this is done, so there is nothing to bypass here.
 */
export function MfaGate({ email, onDone, onSignOut }: { email: string; onDone: () => Promise<void> | void; onSignOut: () => void }) {
  const [step, setStep] = useState<Step>({ kind: 'loading' })
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start() {
    setStep({ kind: 'loading' })
    const { data, error: listErr } = await supabase.auth.mfa.listFactors()
    if (listErr || !data) return setStep({ kind: 'failed', message: 'Could not check your authenticator app. Try again.' })
    const verified = data.totp.find((f) => f.status === 'verified')
    if (verified) return setStep({ kind: 'enter', factorId: verified.id })
    // A half finished set up from an earlier visit would block a new one, so clear it first.
    for (const f of data.all.filter((x) => x.factor_type === 'totp' && x.status !== 'verified')) {
      await supabase.auth.mfa.unenroll({ factorId: f.id })
    }
    const { data: enrol, error: enrolErr } = await supabase.auth.mfa.enroll({ factorType: 'totp', issuer: 'BeyondX Console', friendlyName: email })
    if (enrolErr || !enrol) return setStep({ kind: 'failed', message: 'Could not start the set up. Try again.' })
    setStep({ kind: 'enrol', factorId: enrol.id, qr: enrol.totp.qr_code, secret: enrol.totp.secret })
  }

  useEffect(() => {
    void start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (step.kind !== 'enter' && step.kind !== 'enrol') return
    if (!CODE.test(code)) return setError('Enter the 6 digit code from your app.')
    setBusy(true)
    setError(null)
    const { error: verifyErr } = await supabase.auth.mfa.challengeAndVerify({ factorId: step.factorId, code })
    if (verifyErr) {
      setBusy(false)
      setCode('')
      return setError('That code did not work. Wait for the next code and try again.')
    }
    // The session now carries the stronger sign in. Get the new token and let the console reload who you are.
    await supabase.auth.refreshSession()
    await onDone()
    setBusy(false)
  }

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col justify-center gap-5 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-50">{step.kind === 'enrol' ? 'Set up your authenticator app' : 'Enter your code'}</h1>
        <p className="mt-1 text-sm text-ink-300">
          {step.kind === 'enrol'
            ? 'Your role needs a second step at sign in. Scan the code below with an authenticator app such as Google Authenticator, then enter the 6 digit code it shows.'
            : 'Open your authenticator app and enter the 6 digit code for this console.'}
        </p>
      </div>

      {step.kind === 'loading' && <Spinner label="Checking your sign in" />}
      {step.kind === 'failed' && <ErrorState message={step.message} onRetry={() => void start()} />}

      {step.kind === 'enrol' && (
        <div className="space-y-2">
          <img src={step.qr} alt="Authenticator app set up code" className="h-44 w-44 rounded bg-white p-2" />
          <p className="text-xs text-ink-300">Cannot scan it? Enter this key in your app instead:</p>
          <code className="block break-all rounded bg-ink-800 p-2 text-sm text-ink-50">{step.secret}</code>
        </div>
      )}

      {(step.kind === 'enter' || step.kind === 'enrol') && (
        <form onSubmit={submit} className="space-y-4" aria-label="Authenticator code">
          <div>
            <label className="label" htmlFor="mfa-code">6 digit code</label>
            <input
              id="mfa-code"
              className="field tracking-widest"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
          </div>
          {error && <p role="alert" className="text-sm text-danger-400">{error}</p>}
          <Button type="submit" busy={busy} className="w-full">{step.kind === 'enrol' ? 'Confirm and continue' : 'Continue'}</Button>
        </form>
      )}

      <Button variant="ghost" onClick={onSignOut}>Sign out</Button>
    </div>
  )
}
