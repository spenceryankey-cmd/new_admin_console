import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { STATUS_LABELS, coordinatorSchema, type CoordinatorDetail, type CoordinatorMetrics, type CoordinatorSummary, type XpertStatus } from '@beyondx/shared'
import { useAuth } from '../auth/AuthProvider'
import { ActionDialog, Badge, Button, EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui'
import { api, errorText } from '../lib/api'

function Metrics({ m }: { m: CoordinatorMetrics }) {
  const cells: [string, string][] = [
    ['Xperts on the team', String(m.xperts)],
    ['Active now', String(m.activeXperts)],
    ['Jobs live', String(m.jobsLive)],
    ['Jobs completed', String(m.jobsCompleted)],
    ['Clean jobs', String(m.cleanJobs)],
    ['Average rating', m.avgRating === null ? 'No data yet' : `${m.avgRating} of 5`],
    ['Flags upheld', String(m.flagsUpheld)],
  ]
  return <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">{cells.map(([l, v]) => <div key={l}><dt className="text-xs text-ink-400">{l}</dt><dd className="text-lg font-semibold text-ink-50">{v}</dd></div>)}</dl>
}

export function Coordinators() {
  const { has } = useAuth()
  const qc = useQueryClient()
  const [creating, setCreating] = useState(false)
  const list = useQuery({ queryKey: ['coordinators'], queryFn: () => api<{ coordinators: CoordinatorSummary[] }>('/coordinators') })
  const [f, setF] = useState({ fullName: '', phone: '', area: '', note: '' })
  return (
    <>
      <PageHeader title="Coordinators" subtitle="Team leads who vouch for Xperts. Every number here is worked out from the records of the Xperts on their team." action={has('coordinators.manage') && <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" aria-hidden /> Add coordinator</Button>} />
      {list.isPending && <Spinner label="Loading coordinators" />}
      {list.isError && <ErrorState message={errorText(list.error)} onRetry={() => void list.refetch()} />}
      {list.data && list.data.coordinators.length === 0 && <EmptyState title="No coordinators yet" hint="Add one, then put Xperts on their team from the coordinator's page." />}
      {list.data && list.data.coordinators.length > 0 && (
        <ul className="space-y-3">
          {list.data.coordinators.map((c) => (
            <li key={c.id}>
              <Link to={`/coordinators/${c.id}`} className="card block p-4 transition hover:border-forest-600">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div><p className="text-sm font-semibold text-ink-50">{c.fullName}</p><p className="text-xs text-ink-300">{[c.area, c.phone].filter(Boolean).join(' · ') || 'No area or phone recorded'}</p></div>
                  {!c.active && <Badge tone="neutral">Inactive</Badge>}
                </div>
                <Metrics m={c.metrics} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {creating && (
        <ActionDialog title="Add a coordinator" confirmLabel="Save" requireReason={false} onClose={() => setCreating(false)} onConfirm={async () => {
          const parsed = coordinatorSchema.safeParse({ fullName: f.fullName, phone: f.phone || undefined, area: f.area || undefined, note: f.note || undefined })
          if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Check the details')
          await api('/coordinators', { method: 'POST', body: parsed.data }); await qc.invalidateQueries({ queryKey: ['coordinators'] })
        }}>
          <div><label className="label" htmlFor="co-n">Full name</label><input id="co-n" className="field" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></div>
          <div><label className="label" htmlFor="co-p">Phone</label><input id="co-p" className="field" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
          <div><label className="label" htmlFor="co-a">Area</label><input id="co-a" className="field" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} /></div>
          <div><label className="label" htmlFor="co-t">Note (optional)</label><input id="co-t" className="field" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
        </ActionDialog>
      )}
    </>
  )
}

export function CoordinatorDetailPage() {
  const { id = '' } = useParams()
  const { has } = useAuth()
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [toggle, setToggle] = useState(false)
  const [xpertId, setXpertId] = useState('')
  const q = useQuery({ queryKey: ['coordinator', id], queryFn: () => api<CoordinatorDetail>(`/coordinators/${id}`) })
  const refresh = () => Promise.all(['coordinator', 'coordinators'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
  if (q.isPending) return <Spinner label="Loading the coordinator" />
  if (q.isError) return <ErrorState message={errorText(q.error)} onRetry={() => void q.refetch()} />
  const { coordinator: c, metrics, roster } = q.data
  return (
    <>
      <Link to="/coordinators" className="mb-4 inline-flex min-h-[36px] items-center gap-2 text-sm text-ink-300 hover:text-ink-50"><ArrowLeft className="h-4 w-4" aria-hidden /> All coordinators</Link>
      <PageHeader title={c.fullName} subtitle={[c.area, c.phone].filter(Boolean).join(' · ') || undefined} action={!c.active ? <Badge tone="neutral">Inactive</Badge> : undefined} />
      <section className="card p-4 sm:p-5"><h2 className="mb-3 text-sm font-semibold text-ink-50">Team metrics</h2><Metrics m={metrics} /></section>
      <section className="card mt-6 p-4 sm:p-5" aria-labelledby="ro-h">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="ro-h" className="text-sm font-semibold text-ink-50">The team</h2>
          {has('coordinators.manage') && c.active && <Button variant="secondary" onClick={() => setAdding(true)}>Put an Xpert on this team</Button>}
        </div>
        {roster.length === 0 ? <p className="mt-2 text-sm text-ink-300">Nobody yet.</p> : (
          <ul className="mt-3 space-y-2 text-sm">
            {roster.map((r) => (
              <li key={r.xpertId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ink-700 p-3">
                <Link to={`/xperts/${r.xpertId}`} className="font-semibold text-ink-50 hover:underline">{r.fullName ?? r.xpertId}</Link>
                <span className="text-xs text-ink-300">{r.status ? STATUS_LABELS[r.status as XpertStatus] ?? r.status : 'Unknown'} · {r.reliability.jobsCompleted} done · {r.reliability.cleanJobs} clean · {r.reliability.avgRating === null ? 'no rating' : `${r.reliability.avgRating} of 5`}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {has('coordinators.manage') && <div className="mt-6"><Button variant="ghost" onClick={() => setToggle(true)}>{c.active ? 'Make inactive' : 'Make active again'}</Button></div>}
      {adding && (
        <ActionDialog title="Put an Xpert on this team" description="An Xpert has one coordinator at a time. This moves them from any other." confirmLabel="Add to team" onClose={() => setAdding(false)} onConfirm={async (reason) => { await api(`/coordinators/${id}/xperts`, { method: 'POST', body: { xpertId: xpertId.trim(), reason } }); await refresh() }}>
          <div><label className="label" htmlFor="ax-i">Xpert id</label><input id="ax-i" className="field" placeholder="Copy it from the Xpert's page address" value={xpertId} onChange={(e) => setXpertId(e.target.value)} /></div>
        </ActionDialog>
      )}
      {toggle && <ActionDialog title={c.active ? 'Make this coordinator inactive' : 'Make this coordinator active'} confirmLabel="Confirm" onClose={() => setToggle(false)} onConfirm={async (reason) => { await api(`/coordinators/${id}/active`, { method: 'PUT', body: { active: !c.active, reason } }); await refresh() }} />}
    </>
  )
}
