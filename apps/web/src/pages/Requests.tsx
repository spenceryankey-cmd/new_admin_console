import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Search } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { REQUEST_STATUSES, REQUEST_STATUS_LABELS, createRequestSchema, formatGhs, type RequestStatus, type RequestSummary } from '@beyondx/shared'
import { useAuth } from '../auth/AuthProvider'
import { ActionDialog, Button, EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui'
import { RequestStatusBadge } from '../components/requests'
import { api, errorText } from '../lib/api'
import { dateTime } from '../lib/format'

const PAGE = 30

export function Requests() {
  const { has } = useAuth()
  const qc = useQueryClient()
  const [status, setStatus] = useState<RequestStatus | ''>('')
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [creating, setCreating] = useState(false)

  const list = useQuery({
    queryKey: ['requests', status, q, limit],
    queryFn: () => api<{ requests: RequestSummary[]; total: number }>(`/requests?limit=${limit}${status ? `&status=${status}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`),
    placeholderData: (prev) => prev,
  })

  return (
    <>
      <PageHeader
        title="Requests and quotes"
        subtitle="What employers have asked for. Prepare a quote, send it, and record the employer's answer. The employer can only accept or decline."
        action={has('quotes.compose') && <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" aria-hidden /> New request</Button>}
      />
      <form className="mb-4 flex flex-col gap-3 sm:flex-row" onSubmit={(e) => { e.preventDefault(); setQ(text.trim()); setLimit(PAGE) }}>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-ink-400" aria-hidden />
          <input className="field pl-9" placeholder="Search by employer, phone or category" aria-label="Search requests" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <select className="field sm:w-56" aria-label="Filter by status" value={status} onChange={(e) => { setStatus(e.target.value as RequestStatus | ''); setLimit(PAGE) }}>
          <option value="">All statuses</option>
          {REQUEST_STATUSES.map((s) => <option key={s} value={s}>{REQUEST_STATUS_LABELS[s]}</option>)}
        </select>
        <Button type="submit" variant="secondary">Search</Button>
      </form>

      {list.isPending && <Spinner label="Loading requests" />}
      {list.isError && <ErrorState message={errorText(list.error)} onRetry={() => void list.refetch()} />}
      {list.data && list.data.requests.length === 0 && <EmptyState title="No requests match" hint={status || q ? 'Try a different status or search.' : 'Requests appear here as employers send them.'} />}
      {list.data && list.data.requests.length > 0 && (
        <>
          <p className="mb-3 text-xs text-ink-300">Showing {list.data.requests.length} of {list.data.total}</p>
          <ul className="space-y-3">
            {list.data.requests.map((r) => (
              <li key={r.id}>
                <Link to={`/requests/${r.id}`} className="card flex flex-wrap items-center gap-x-6 gap-y-2 p-4 transition hover:border-forest-600">
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="text-sm font-semibold text-ink-50">{r.category}</p>
                    <p className="truncate text-sm text-ink-300">{r.employerName} · {r.location}</p>
                    <p className="mt-0.5 text-xs text-ink-400">Received {dateTime(r.createdAt)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {r.quotedGhs !== null && <span className="text-sm font-semibold text-ink-50">{formatGhs(r.quotedGhs)}</span>}
                    <RequestStatusBadge status={r.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          {list.data.total > list.data.requests.length && (
            <div className="mt-4 flex justify-center"><Button variant="secondary" busy={list.isFetching} onClick={() => setLimit((l) => l + PAGE)}>Show more</Button></div>
          )}
        </>
      )}
      {creating && <NewRequestDialog onClose={() => setCreating(false)} onDone={() => qc.invalidateQueries({ queryKey: ['requests'] })} />}
    </>
  )
}

function NewRequestDialog({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<unknown> }) {
  const [f, setF] = useState({ employerName: '', employerPhone: '', category: '', description: '', location: '', timing: '', specialRequirements: '' })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const create = useMutation({ mutationFn: (body: unknown) => api('/requests', { method: 'POST', body }) })
  return (
    <ActionDialog
      title="New request"
      description="For a request taken by phone or message. Requests from the main site arrive here by themselves."
      confirmLabel="Save request"
      requireReason={false}
      onClose={onClose}
      onConfirm={async () => {
        const parsed = createRequestSchema.safeParse({ ...f, specialRequirements: f.specialRequirements || undefined })
        if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Check the details')
        await create.mutateAsync(parsed.data)
        await onDone()
      }}
    >
      <div><label className="label" htmlFor="rq-n">Employer name</label><input id="rq-n" className="field" value={f.employerName} onChange={set('employerName')} /></div>
      <div><label className="label" htmlFor="rq-p">Employer phone</label><input id="rq-p" className="field" value={f.employerPhone} onChange={set('employerPhone')} /></div>
      <div><label className="label" htmlFor="rq-c">Category</label><input id="rq-c" className="field" placeholder="For example Tiling" value={f.category} onChange={set('category')} /></div>
      <div><label className="label" htmlFor="rq-d">What needs doing</label><textarea id="rq-d" rows={3} className="field" value={f.description} onChange={set('description')} /></div>
      <div><label className="label" htmlFor="rq-l">Location</label><input id="rq-l" className="field" value={f.location} onChange={set('location')} /></div>
      <div><label className="label" htmlFor="rq-t">When</label><input id="rq-t" className="field" placeholder="For example Saturday morning" value={f.timing} onChange={set('timing')} /></div>
      <div><label className="label" htmlFor="rq-s">Special requirements (optional)</label><textarea id="rq-s" rows={2} className="field" value={f.specialRequirements} onChange={set('specialRequirements')} /></div>
    </ActionDialog>
  )
}
