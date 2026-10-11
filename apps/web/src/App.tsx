import { Navigate, Route, Routes } from 'react-router-dom'
import type { Permission } from '@beyondx/shared'
import { useAuth } from './auth/AuthProvider'
import { Button, ErrorState, Spinner } from './components/ui'
import { configError } from './lib/supabase'
import { AppShell } from './layout/AppShell'
import { ALL_ITEMS } from './layout/nav'
import { AuditLog } from './pages/AuditLog'
import { Approvals } from './pages/Approvals'
import { Dashboard } from './pages/Dashboard'
import { EvidenceQueue } from './pages/EvidenceQueue'
import { GuarantorQueue } from './pages/GuarantorQueue'
import { ReferenceQueue } from './pages/ReferenceQueue'
import { Pricing } from './pages/Pricing'
import { RequestDetailPage } from './pages/RequestDetail'
import { Requests } from './pages/Requests'
import { Jobs } from './pages/Jobs'
import { JobDetailPage } from './pages/JobDetail'
import { ChangeOrders } from './pages/ChangeOrders'
import { Flags } from './pages/Flags'
import { FlagDetailPage } from './pages/FlagDetail'
import { Feedback } from './pages/Feedback'
import { CoordinatorDetailPage, Coordinators } from './pages/Coordinators'
import { Settings } from './pages/Settings'
import { XpertDetailPage } from './pages/XpertDetail'
import { Xperts } from './pages/Xperts'
import { Login } from './pages/Login'
import { NoAccess, NotFound, Placeholder } from './pages/Placeholder'
import { Roles } from './pages/Roles'
import { SetPassword } from './pages/SetPassword'
import { Staff } from './pages/Staff'

function Protected() {
  const { loading, session, me, denied, meError, retryMe, signOut } = useAuth()
  if (loading) return <Spinner label="Loading" />
  if (!session) return <Navigate to="/login" replace />
  if (denied) {
    return (
      <div className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
        <ErrorState message={denied} />
        <Button variant="secondary" onClick={() => void signOut()}>Sign out</Button>
      </div>
    )
  }
  if (meError || !me) {
    return (
      <div className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center gap-4 p-6">
        <ErrorState message={meError ?? 'Could not load your account'} onRetry={retryMe} />
        <Button variant="ghost" onClick={() => void signOut()}>Sign out</Button>
      </div>
    )
  }
  return <AppShell />
}

function Gate({ anyOf, children }: { anyOf: readonly Permission[]; children: React.ReactNode }) {
  const { hasAny } = useAuth()
  return anyOf.length === 0 || hasAny(anyOf) ? <>{children}</> : <NoAccess />
}

const BUILT: Record<string, React.ReactNode> = {
  '/': <Dashboard />,
  '/staff': <Staff />,
  '/roles': <Roles />,
  '/audit': <AuditLog />,
  '/xperts': <Xperts />,
  '/guarantors': <GuarantorQueue />,
  '/evidence': <EvidenceQueue />,
  '/references': <ReferenceQueue />,
  '/approvals': <Approvals />,
  '/settings': <Settings />,
  '/requests': <Requests />,
  '/pricing': <Pricing />,
  '/jobs': <Jobs />,
  '/change-orders': <ChangeOrders />,
  '/flags': <Flags />,
  '/feedback': <Feedback />,
  '/coordinators': <Coordinators />,
}

export default function App() {
  if (configError) {
    return (
      <div className="mx-auto flex min-h-full max-w-md items-center p-6">
        <ErrorState message={configError} />
      </div>
    )
  }
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/set-password" element={<SetPassword />} />
      <Route element={<Protected />}>
        {ALL_ITEMS.map((item) => (
          <Route
            key={item.to}
            path={item.to}
            element={<Gate anyOf={item.anyOf}>{BUILT[item.to] ?? <Placeholder />}</Gate>}
          />
        ))}
        <Route path="/xperts/:id" element={<Gate anyOf={['xperts.read']}><XpertDetailPage /></Gate>} />
        <Route path="/requests/:id" element={<Gate anyOf={['quotes.read']}><RequestDetailPage /></Gate>} />
        <Route path="/jobs/:id" element={<Gate anyOf={['jobs.monitor']}><JobDetailPage /></Gate>} />
        <Route path="/flags/:id" element={<Gate anyOf={['flags.read']}><FlagDetailPage /></Gate>} />
        <Route path="/coordinators/:id" element={<Gate anyOf={['coordinators.read']}><CoordinatorDetailPage /></Gate>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
