import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { PERMISSION_LABELS, ROLE_LABELS, type JobCounts, type Permission, type TrustCounts, type QueueCounts, type RequestCounts } from '@beyondx/shared'
import { useAuth } from '../auth/AuthProvider'
import { Badge, ErrorState, PageHeader, Spinner } from '../components/ui'
import { api, errorText } from '../lib/api'
import { FUTURE_ITEMS } from '../layout/nav'

const QUEUES: { key: keyof QueueCounts; label: string; to: string; needs: Permission; hint: string }[] = [
  { key: 'guarantors', label: 'Guarantors to confirm', to: '/guarantors', needs: 'guarantors.review', hint: 'Applicants waiting on the explainer message or the callback.' },
  { key: 'evidence', label: 'Evidence to review', to: '/evidence', needs: 'evidence.review', hint: 'Skill evidence waiting for a pass or fail.' },
  { key: 'references', label: 'References to call', to: '/references', needs: 'references.review', hint: 'References not yet confirmed or closed.' },
  { key: 'approvals', label: 'In skill verification', to: '/approvals', needs: 'xperts.read', hint: 'Xperts who could be approved once screening is complete.' },
]

const REQUEST_CARDS: { key: keyof RequestCounts; label: string; hint: string }[] = [
  { key: 'newRequests', label: 'New requests', hint: 'Waiting for a quote.' },
  { key: 'awaitingResponse', label: 'Quotes out', hint: 'Sent, waiting for the employer to accept or decline.' },
  { key: 'awaitingPayment', label: 'Payments to record', hint: 'Accepted quotes where the MoMo payment has not been recorded.' },
]

function RequestCards() {
  const { has } = useAuth()
  const counts = useQuery({ queryKey: ['req-counts'], queryFn: () => api<RequestCounts>('/requests/counts'), enabled: has('quotes.read'), refetchInterval: 60_000 })
  if (!has('quotes.read')) return null
  return (
    <section aria-labelledby="req-h" className="mb-6">
      <h2 id="req-h" className="mb-3 text-sm font-semibold text-ink-50">Requests and quotes</h2>
      {counts.isPending && <Spinner label="Loading counts" />}
      {counts.isError && <ErrorState message={errorText(counts.error)} onRetry={() => void counts.refetch()} />}
      {counts.data && (
        <div className="grid gap-3 sm:grid-cols-3">
          {REQUEST_CARDS.map((c) => (
            <Link key={c.key} to="/requests" className="card p-4 transition hover:border-forest-600">
              <span className="block text-3xl font-semibold text-ink-50">{counts.data[c.key]}</span>
              <span className="mt-1 block text-sm font-medium text-ink-100">{c.label}</span>
              <span className="mt-0.5 block text-xs text-ink-300">{c.hint}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}

const JOB_CARDS: { key: keyof JobCounts; label: string; hint: string; to: string }[] = [
  { key: 'needsXpert', label: 'Jobs needing an Xpert', hint: 'Paid for and waiting to be dispatched.', to: '/jobs' },
  { key: 'live', label: 'Jobs live now', hint: 'Dispatched or in progress.', to: '/jobs' },
  { key: 'needsAttention', label: 'Jobs needing attention', hint: 'Not started, or waiting too long for a confirmation.', to: '/jobs' },
  { key: 'changeOrdersWaiting', label: 'Change orders waiting', hint: 'Waiting for the employer or the Xpert to confirm.', to: '/change-orders' },
  { key: 'recurringDue', label: 'Recurring services due', hint: 'Standing requests ready to create a new request.', to: '/jobs' },
]

function JobCards() {
  const { has } = useAuth()
  const counts = useQuery({ queryKey: ['job-counts'], queryFn: () => api<JobCounts>('/jobs/counts'), enabled: has('jobs.monitor'), refetchInterval: 60_000 })
  if (!has('jobs.monitor')) return null
  return (
    <section aria-labelledby="job-h" className="mb-6">
      <h2 id="job-h" className="mb-3 text-sm font-semibold text-ink-50">Jobs</h2>
      {counts.isPending && <Spinner label="Loading counts" />}
      {counts.isError && <ErrorState message={errorText(counts.error)} onRetry={() => void counts.refetch()} />}
      {counts.data && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {JOB_CARDS.map((c) => (
            <Link key={c.key} to={c.to} className="card p-4 transition hover:border-forest-600">
              <span className="block text-3xl font-semibold text-ink-50">{counts.data[c.key]}</span>
              <span className="mt-1 block text-sm font-medium text-ink-100">{c.label}</span>
              <span className="mt-0.5 block text-xs text-ink-300">{c.hint}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}

function TrustCards() {
  const { has } = useAuth()
  const counts = useQuery({ queryKey: ['trust-counts'], queryFn: () => api<TrustCounts>('/reliability/counts'), enabled: has('flags.read'), refetchInterval: 60_000 })
  if (!has('flags.read') || !counts.data) return null
  return (
    <section aria-labelledby="trust-h" className="mb-6">
      <h2 id="trust-h" className="mb-3 text-sm font-semibold text-ink-50">Flags and feedback</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Link to="/flags" className="card p-4 transition hover:border-forest-600"><span className="block text-3xl font-semibold text-ink-50">{counts.data.flagsOpen}</span><span className="mt-1 block text-sm font-medium text-ink-100">Open flags</span><span className="mt-0.5 block text-xs text-ink-300">Waiting for a decision maker.</span></Link>
        <Link to="/feedback" className="card p-4 transition hover:border-forest-600"><span className="block text-3xl font-semibold text-ink-50">{counts.data.feedbackThisWeek}</span><span className="mt-1 block text-sm font-medium text-ink-100">Feedback this week</span><span className="mt-0.5 block text-xs text-ink-300">Logged from employers and Xperts.</span></Link>
      </div>
    </section>
  )
}

function QueueCards() {
  const { has } = useAuth()
  const visible = QUEUES.filter((c) => has(c.needs))
  const counts = useQuery({ queryKey: ['counts'], queryFn: () => api<QueueCounts>('/queues/counts'), enabled: has('dashboard.view') && visible.length > 0, refetchInterval: 60_000 })
  if (visible.length === 0) return null
  return (
    <section aria-labelledby="queues-h" className="mb-6">
      <h2 id="queues-h" className="mb-3 text-sm font-semibold text-ink-50">Waiting for you</h2>
      {counts.isPending && <Spinner label="Loading counts" />}
      {counts.isError && <ErrorState message={errorText(counts.error)} onRetry={() => void counts.refetch()} />}
      {counts.data && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {visible.map((c) => (
            <Link key={c.key} to={c.to} className="card p-4 transition hover:border-forest-600">
              <span className="block text-3xl font-semibold text-ink-50">{counts.data[c.key]}</span>
              <span className="mt-1 block text-sm font-medium text-ink-100">{c.label}</span>
              <span className="mt-0.5 block text-xs text-ink-300">{c.hint}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}

export function Dashboard() {
  const { me, hasAny } = useAuth()
  if (!me) return null
  const coming = FUTURE_ITEMS.filter((i) => hasAny(i.anyOf))

  return (
    <>
      <PageHeader
        title={`Welcome, ${me.staff.fullName.split(' ')[0]}`}
        subtitle="What is waiting in each queue, and what your role allows."
      />
      <QueueCards />
      <RequestCards />
      <JobCards />
      <TrustCards />
      <section className="card p-5" aria-labelledby="role-h">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="role-h" className="text-sm font-semibold text-ink-50">Your role</h2>
          <Badge tone="green">{ROLE_LABELS[me.staff.role]}</Badge>
        </div>
        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink-300">You can</h3>
        <ul className="mt-2 grid gap-1.5 text-sm text-ink-100 sm:grid-cols-2">
          {me.permissions.length === 0 && <li className="text-ink-300">Nothing yet. Ask a super admin to update your role.</li>}
          {me.permissions.map((p) => (
            <li key={p} className="flex gap-2">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-forest-500" aria-hidden />
              {PERMISSION_LABELS[p]}
            </li>
          ))}
        </ul>
      </section>

      {coming.length > 0 && (
        <section className="mt-6" aria-labelledby="soon-h">
          <h2 id="soon-h" className="mb-3 text-sm font-semibold text-ink-50">Coming in later phases</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {coming.map((i) => (
              <Link key={i.to} to={i.to} className="card flex items-start gap-3 p-4 transition hover:border-forest-600">
                <i.icon className="mt-0.5 h-4 w-4 shrink-0 text-forest-500" aria-hidden />
                <span>
                  <span className="block text-sm font-medium text-ink-50">{i.label}</span>
                  <span className="mt-0.5 block text-xs text-ink-300">{i.summary}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  )
}
