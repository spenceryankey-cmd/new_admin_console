import { LogOut, Menu, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { ROLE_LABELS } from '@beyondx/shared'
import { useAuth } from '../auth/AuthProvider'
import { OfflineBanner } from '../components/ui'
import { NAV } from './nav'

export function AppShell() {
  const { me, hasAny, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const location = useLocation()

  useEffect(() => setOpen(false), [location.pathname])

  const groups = NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => i.anyOf.length === 0 || hasAny(i.anyOf)),
  })).filter((g) => g.items.length > 0)

  const sidebar = (
    <nav aria-label="Main" className="flex h-full flex-col">
      <div className="flex items-center justify-between px-5 py-5">
        <img src="/beyondx-logo-light.png" alt="BeyondX" className="h-6 w-auto" />
        <button className="rounded-lg p-2 text-ink-300 hover:bg-ink-800 lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
          <X className="h-5 w-5" />
        </button>
      </div>
      <p className="px-5 pb-2 text-xs font-semibold uppercase tracking-wider text-forest-500">Admin console</p>
      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {groups.map((g) => (
          <div key={g.title} className="mt-4 first:mt-0">
            <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-400">{g.title}</p>
            {g.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `flex min-h-[40px] items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition ${
                    isActive ? 'bg-forest-600/15 font-semibold text-forest-300' : 'text-ink-200 hover:bg-ink-800'
                  }`
                }
              >
                <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                <span className="flex-1">{item.label}</span>
                {item.phase > 3 && <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-300">Phase {item.phase}</span>}
              </NavLink>
            ))}
          </div>
        ))}
      </div>
      <div className="border-t border-ink-700 p-4">
        <p className="truncate text-sm font-medium text-ink-50">{me?.staff.fullName}</p>
        <p className="truncate text-xs text-ink-300">{me ? ROLE_LABELS[me.staff.role] : ''}</p>
        <button onClick={() => void signOut()} className="mt-3 flex min-h-[40px] w-full items-center gap-2 rounded-lg px-2.5 text-sm text-ink-200 hover:bg-ink-800">
          <LogOut className="h-4 w-4" aria-hidden />
          Sign out
        </button>
      </div>
    </nav>
  )

  return (
    <div className="flex h-full flex-col">
      <OfflineBanner />
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-64 shrink-0 border-r border-ink-700 bg-ink-900 lg:block">{sidebar}</aside>

        {open && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-black/70" onClick={() => setOpen(false)} />
            <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-ink-900 shadow-xl">{sidebar}</aside>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-3 border-b border-ink-700 bg-ink-900 px-4 py-3 lg:hidden">
            <button className="rounded-lg p-2 text-ink-100 hover:bg-ink-800" onClick={() => setOpen(true)} aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </button>
            <img src="/beyondx-logo-light.png" alt="BeyondX" className="h-5 w-auto" />
          </header>
          <main className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}
