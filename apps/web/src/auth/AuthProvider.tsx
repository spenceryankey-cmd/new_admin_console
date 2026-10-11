import type { Session } from '@supabase/supabase-js'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { can, type MeResponse, type Permission } from '@beyondx/shared'
import { api, ApiError } from '../lib/api'
import { supabase } from '../lib/supabase'

type AuthState = {
  loading: boolean
  session: Session | null
  me: MeResponse | null
  /** Set when signed in to Supabase but not allowed into the console. */
  denied: string | null
  meError: string | null
  retryMe: () => void
  signOut: () => Promise<void>
  has: (needed: Permission | readonly Permission[]) => boolean
  hasAny: (needed: readonly Permission[]) => boolean
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [session, setSession] = useState<Session | null>(null)
  const [booting, setBooting] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setBooting(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next)
      if (event === 'SIGNED_OUT') qc.clear()
    })
    return () => sub.subscription.unsubscribe()
  }, [qc])

  const meQuery = useQuery({
    queryKey: ['me', session?.user.id],
    enabled: !!session,
    queryFn: () => api<MeResponse>('/me'),
    retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    staleTime: 60_000,
  })

  // Record one sign in per browser session in the audit log.
  const userId = session?.user.id
  const signedIn = !!meQuery.data
  useEffect(() => {
    if (!userId || !signedIn) return
    const key = `bx_signin_logged_${userId}`
    try {
      if (sessionStorage.getItem(key)) return
      sessionStorage.setItem(key, '1')
    } catch {
      /* storage blocked, log anyway */
    }
    api('/me/sign-in', { method: 'POST' }).catch(() => undefined)
  }, [userId, signedIn])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    qc.clear()
  }, [qc])

  const value = useMemo<AuthState>(() => {
    const me = meQuery.data ?? null
    const err = meQuery.error
    const denied = err instanceof ApiError && (err.status === 403 || err.status === 401) ? err.message : null
    const perms = new Set(me?.permissions ?? [])
    const subject = me ? { role: me.staff.role, permissions: perms } : null
    return {
      loading: booting || (!!session && meQuery.isPending),
      session,
      me,
      denied,
      meError: err && !denied ? err.message : null,
      retryMe: () => void meQuery.refetch(),
      signOut,
      has: (needed) => (subject ? can(subject, needed) : false),
      hasAny: (needed) => (subject ? needed.some((p) => can(subject, p)) : false),
    }
  }, [booting, session, meQuery, signOut])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth must be used inside AuthProvider')
  return v
}
