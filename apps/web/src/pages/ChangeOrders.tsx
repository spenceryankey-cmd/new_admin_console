import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CHANGE_ORDER_LABELS, CHANGE_ORDER_STATUSES, formatGhs, type ChangeOrderRecord, type ChangeOrderStatus } from '@beyondx/shared'
import { ActionDialog, Button, EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui'
import { ChangeOrderBadge } from '../components/jobs'
import { api, errorText } from '../lib/api'
import { dateTime } from '../lib/format'

type Dialog = { kind: 'confirm'; c: ChangeOrderRecord; side: 'employer' | 'xpert' } | { kind: 'reject'; c: ChangeOrderRecord } | { kind: 'cancel'; c: ChangeOrderRecord } | null

export function ChangeOrders() {
  const qc = useQueryClient()
  const [status, setStatus] = useState<ChangeOrderStatus | ''>('logged')
  const [dialog, setDialog] = useState<Dialog>(null)
  const [side, setSide] = useState<'employer' | 'xpert'>('employer')
  const list = useQuery({ queryKey: ['change-orders', status], queryFn: () => api<{ changeOrders: ChangeOrderRecord[] }>(`/change-orders${status ? `?status=${status}` : ''}`) })
  const refresh = () => Promise.all(['change-orders', 'job', 'job-counts'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
  return (
    <>
      <PageHeader title="Change orders" subtitle="Scope changes on live jobs. A change order counts only when the employer and the Xpert have both confirmed it." />
      <div className="mb-4"><select className="field sm:w-64" aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value as ChangeOrderStatus | '')}><option value="">All</option>{CHANGE_ORDER_STATUSES.map((s) => <option key={s} value={s}>{CHANGE_ORDER_LABELS[s]}</option>)}</select></div>
      {list.isPending && <Spinner label="Loading change orders" />}
      {list.isError && <ErrorState message={errorText(list.error)} onRetry={() => void list.refetch()} />}
      {list.data && list.data.changeOrders.length === 0 && <EmptyState title="No change orders" hint="Log one from a job that has an Xpert on it." />}
      {list.data && list.data.changeOrders.length > 0 && (
        <ul className="space-y-3">
          {list.data.changeOrders.map((c) => (
            <li key={c.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink-50">{c.description}</p>
                  <p className="text-sm text-ink-300"><Link className="hover:underline" to={`/jobs/${c.jobId}`}>{c.jobLabel ?? 'Job'}</Link> · {c.amountDeltaGhs >= 0 ? '+' : ''}{formatGhs(c.amountDeltaGhs)}</p>
                  <p className="mt-0.5 text-xs text-ink-400">Logged {dateTime(c.createdAt)}{c.loggedByName ? ` by ${c.loggedByName}` : ''}</p>
                  <p className="mt-0.5 text-xs text-ink-300">Employer: {c.employerConfirmedAt ? 'confirmed' : 'waiting'} · Xpert: {c.xpertConfirmedAt ? 'confirmed' : 'waiting'}{c.rejectedBy ? ` · Rejected by the ${c.rejectedBy}: ${c.note ?? ''}` : ''}</p>
                </div>
                <ChangeOrderBadge status={c.status} />
              </div>
              {c.status === 'logged' && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {!c.employerConfirmedAt && <Button variant="secondary" onClick={() => { setSide('employer'); setDialog({ kind: 'confirm', c, side: 'employer' }) }}>Employer confirmed</Button>}
                  {!c.xpertConfirmedAt && <Button variant="secondary" onClick={() => setDialog({ kind: 'confirm', c, side: 'xpert' })}>Xpert confirmed</Button>}
                  <Button variant="ghost" onClick={() => { setSide('employer'); setDialog({ kind: 'reject', c }) }}>Log a rejection</Button>
                  <Button variant="ghost" onClick={() => setDialog({ kind: 'cancel', c })}>Cancel</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {dialog?.kind === 'confirm' && <ActionDialog title={dialog.side === 'employer' ? 'Employer confirmed' : 'Xpert confirmed'} description="Log that this side has agreed to the change." confirmLabel="Log confirmation" requireReason={false} onClose={() => setDialog(null)} onConfirm={async () => { await api(`/change-orders/${dialog.c.id}/confirm`, { method: 'POST', body: { side: dialog.side } }); await refresh() }} />}
      {dialog?.kind === 'reject' && (
        <ActionDialog title="Log a rejection" reasonLabel="What they said" confirmLabel="Log rejection" danger onClose={() => setDialog(null)} onConfirm={async (note) => { await api(`/change-orders/${dialog.c.id}/reject`, { method: 'POST', body: { side, note } }); await refresh() }}>
          <div><label className="label" htmlFor="rj-s">Who rejected it</label><select id="rj-s" className="field" value={side} onChange={(e) => setSide(e.target.value as 'employer' | 'xpert')}><option value="employer">The employer</option><option value="xpert">The Xpert</option></select></div>
        </ActionDialog>
      )}
      {dialog?.kind === 'cancel' && <ActionDialog title="Cancel this change order" confirmLabel="Cancel change order" onClose={() => setDialog(null)} onConfirm={async (reason) => { await api(`/change-orders/${dialog.c.id}/cancel`, { method: 'POST', body: { reason } }); await refresh() }} />}
    </>
  )
}
