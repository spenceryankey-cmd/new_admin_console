import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Search } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FREQUENCIES, FREQUENCY_LABELS, JOB_STATUSES, JOB_STATUS_LABELS, formatGhs, recurringSchema, type JobCounts, type JobRecord, type JobStatus, type RecurringRecord } from '@beyondx/shared'
import { useAuth } from '../auth/AuthProvider'
import { ActionDialog, Badge, Button, EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui'
import { JobStatusBadge } from '../components/jobs'
import { api, errorText } from '../lib/api'
import { dateTime } from '../lib/format'

const PAGE = 30
type Tab = 'jobs' | 'attention' | 'recurring'

export function Jobs() {
  const [tab, setTab] = useState<Tab>('jobs')
  const { has } = useAuth()
  const counts = useQuery({ queryKey: ['job-counts'], queryFn: () => api<JobCounts>('/jobs/counts'), enabled: has('jobs.monitor'), refetchInterval: 60_000 })
  const tabs: { id: Tab; label: string; n?: number }[] = [
    { id: 'jobs', label: 'All jobs' },
    { id: 'attention', label: 'Needs attention', n: counts.data?.needsAttention },
    { id: 'recurring', label: 'Recurring services', n: counts.data?.recurringDue },
  ]
  return (
    <>
      <PageHeader title="Job board" subtitle="A job appears here when an employer's payment is recorded. Choose an Xpert, watch the work, and complete it when both sides confirm." />
      {counts.data && (
        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          {[['Need an Xpert', counts.data.needsXpert], ['Live now', counts.data.live], ['Change orders waiting', counts.data.changeOrdersWaiting]].map(([l, n]) => (
            <div key={l} className="card p-4"><span className="block text-3xl font-semibold text-ink-50">{n}</span><span className="mt-1 block text-sm text-ink-100">{l}</span></div>
          ))}
        </div>
      )}
      <div role="tablist" className="mb-4 flex gap-2 overflow-x-auto">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={`min-h-[40px] whitespace-nowrap rounded-lg px-4 text-sm ${tab === t.id ? 'bg-forest-600 font-semibold text-ink-950' : 'border border-ink-600 text-ink-100 hover:bg-ink-800'}`}>
            {t.label}{t.n ? ` (${t.n})` : ''}
          </button>
        ))}
      </div>
      {tab === 'jobs' && <AllJobs />}
      {tab === 'attention' && <Attention />}
      {tab === 'recurring' && <Recurring />}
    </>
  )
}

function JobRow({ j }: { j: JobRecord }) {
  return (
    <li>
      <Link to={`/jobs/${j.id}`} className="card flex flex-wrap items-center gap-x-6 gap-y-2 p-4 transition hover:border-forest-600">
        <div className="min-w-0 flex-1 basis-56">
          <p className="text-sm font-semibold text-ink-50">{j.category} · {formatGhs(j.amountGhs)}</p>
          <p className="truncate text-sm text-ink-300">{j.employerName} · {j.location}</p>
          <p className="mt-0.5 text-xs text-ink-400">{j.xpertName ? `Primary: ${j.xpertName}` : 'No Xpert yet'}{j.backupXpertName ? ` · Backup: ${j.backupXpertName}` : ''} · Created {dateTime(j.createdAt)}</p>
          {j.watch && <p className="mt-1 text-xs text-amber-400">{j.watch.label}</p>}
        </div>
        <JobStatusBadge status={j.status} />
      </Link>
    </li>
  )
}

function AllJobs() {
  const [status, setStatus] = useState<JobStatus | ''>('')
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const list = useQuery({
    queryKey: ['jobs', status, q, limit],
    queryFn: () => api<{ jobs: JobRecord[]; total: number }>(`/jobs?limit=${limit}${status ? `&status=${status}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`),
    placeholderData: (p) => p,
  })
  return (
    <>
      <form className="mb-4 flex flex-col gap-3 sm:flex-row" onSubmit={(e) => { e.preventDefault(); setQ(text.trim()); setLimit(PAGE) }}>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-ink-400" aria-hidden />
          <input className="field pl-9" placeholder="Search by category or location" aria-label="Search jobs" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <select className="field sm:w-56" aria-label="Filter by status" value={status} onChange={(e) => { setStatus(e.target.value as JobStatus | ''); setLimit(PAGE) }}>
          <option value="">All statuses</option>
          {JOB_STATUSES.map((s) => <option key={s} value={s}>{JOB_STATUS_LABELS[s]}</option>)}
        </select>
        <Button type="submit" variant="secondary">Search</Button>
      </form>
      {list.isPending && <Spinner label="Loading jobs" />}
      {list.isError && <ErrorState message={errorText(list.error)} onRetry={() => void list.refetch()} />}
      {list.data && list.data.jobs.length === 0 && <EmptyState title="No jobs match" hint="Jobs appear here once an employer's payment is recorded." />}
      {list.data && list.data.jobs.length > 0 && (
        <>
          <ul className="space-y-3">{list.data.jobs.map((j) => <JobRow key={j.id} j={j} />)}</ul>
          {list.data.total > list.data.jobs.length && <div className="mt-4 flex justify-center"><Button variant="secondary" busy={list.isFetching} onClick={() => setLimit((l) => l + PAGE)}>Show more</Button></div>}
        </>
      )}
    </>
  )
}

function Attention() {
  const q = useQuery({ queryKey: ['jobs-attention'], queryFn: () => api<{ jobs: JobRecord[] }>('/jobs/attention'), refetchInterval: 60_000 })
  if (q.isPending) return <Spinner label="Loading" />
  if (q.isError) return <ErrorState message={errorText(q.error)} onRetry={() => void q.refetch()} />
  if (q.data.jobs.length === 0) return <EmptyState title="Nothing needs attention" hint="Jobs that have not started, or are waiting on a confirmation for too long, show here." />
  return <ul className="space-y-3">{q.data.jobs.map((j) => <JobRow key={j.id} j={j} />)}</ul>
}

function Recurring() {
  const { has } = useAuth()
  const qc = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [pausing, setPausing] = useState<RecurringRecord | null>(null)
  const list = useQuery({ queryKey: ['recurring'], queryFn: () => api<{ services: RecurringRecord[] }>('/recurring') })
  const gen = useMutation({ mutationFn: (id: string) => api(`/recurring/${id}/generate`, { method: 'POST' }), onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['recurring'] }), qc.invalidateQueries({ queryKey: ['requests'] }), qc.invalidateQueries({ queryKey: ['job-counts'] })]) })
  const canEdit = has('quotes.compose')
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['recurring'] }), qc.invalidateQueries({ queryKey: ['job-counts'] })])
  return (
    <>
      {canEdit && <div className="mb-4"><Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" aria-hidden /> New recurring service</Button></div>}
      {list.isPending && <Spinner label="Loading" />}
      {list.isError && <ErrorState message={errorText(list.error)} onRetry={() => void list.refetch()} />}
      {gen.isError && <p role="alert" className="mb-3 text-sm text-danger-400">{errorText(gen.error)}</p>}
      {list.data && list.data.services.length === 0 && <EmptyState title="No recurring services" hint="Add a standing request for an employer. A new request is created each time it comes due." />}
      {list.data && list.data.services.length > 0 && (
        <ul className="space-y-3">
          {list.data.services.map((s) => (
            <li key={s.id} className="card flex flex-wrap items-center gap-x-6 gap-y-2 p-4">
              <div className="min-w-0 flex-1 basis-56">
                <p className="text-sm font-semibold text-ink-50">{s.category} · {FREQUENCY_LABELS[s.frequency]}</p>
                <p className="truncate text-sm text-ink-300">{s.employerName} · {s.location}</p>
                <p className="mt-0.5 text-xs text-ink-400">Next due {s.nextDue}{s.lastGeneratedAt ? ` · Last created ${dateTime(s.lastGeneratedAt)}` : ''}</p>
              </div>
              <div className="flex items-center gap-2">
                {!s.active && <Badge tone="neutral">Paused</Badge>}
                {s.due && <Badge tone="amber">Due</Badge>}
                {canEdit && s.due && <Button variant="secondary" busy={gen.isPending} onClick={() => gen.mutate(s.id)}>Create request now</Button>}
                {canEdit && <Button variant="ghost" onClick={() => setPausing(s)}>{s.active ? 'Pause' : 'Resume'}</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {creating && <NewRecurring onClose={() => setCreating(false)} onDone={refresh} />}
      {pausing && (
        <ActionDialog
          title={pausing.active ? 'Pause this service' : 'Resume this service'}
          confirmLabel={pausing.active ? 'Pause' : 'Resume'}
          onClose={() => setPausing(null)}
          onConfirm={async (reason) => { await api(`/recurring/${pausing.id}/active`, { method: 'PUT', body: { active: !pausing.active, reason } }); await refresh() }}
        />
      )}
    </>
  )
}

function NewRecurring({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<unknown> }) {
  const [f, setF] = useState({ employerName: '', employerPhone: '', category: '', description: '', location: '', timing: '', frequency: 'weekly', nextDue: new Date().toISOString().slice(0, 10) })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  return (
    <ActionDialog
      title="New recurring service"
      description="A new request is created for staff to quote each time this comes due."
      confirmLabel="Save"
      requireReason={false}
      onClose={onClose}
      onConfirm={async () => {
        const parsed = recurringSchema.safeParse(f)
        if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Check the details')
        await api('/recurring', { method: 'POST', body: parsed.data })
        await onDone()
      }}
    >
      <div><label className="label" htmlFor="rc-n">Employer name</label><input id="rc-n" className="field" value={f.employerName} onChange={set('employerName')} /></div>
      <div><label className="label" htmlFor="rc-p">Employer phone</label><input id="rc-p" className="field" value={f.employerPhone} onChange={set('employerPhone')} /></div>
      <div><label className="label" htmlFor="rc-c">Category</label><input id="rc-c" className="field" value={f.category} onChange={set('category')} /></div>
      <div><label className="label" htmlFor="rc-d">What needs doing</label><textarea id="rc-d" rows={2} className="field" value={f.description} onChange={set('description')} /></div>
      <div><label className="label" htmlFor="rc-l">Location</label><input id="rc-l" className="field" value={f.location} onChange={set('location')} /></div>
      <div><label className="label" htmlFor="rc-t">When</label><input id="rc-t" className="field" placeholder="For example Mondays at 8am" value={f.timing} onChange={set('timing')} /></div>
      <div><label className="label" htmlFor="rc-f">How often</label><select id="rc-f" className="field" value={f.frequency} onChange={set('frequency')}>{FREQUENCIES.map((x) => <option key={x} value={x}>{FREQUENCY_LABELS[x]}</option>)}</select></div>
      <div><label className="label" htmlFor="rc-s">First due</label><input id="rc-s" type="date" className="field" value={f.nextDue} onChange={set('nextDue')} /></div>
    </ActionDialog>
  )
}
