import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { PAYMENT_STATUS_LABELS, canReplace, changeOrderSchema, formatGhs, type JobDetail as Detail, type Match } from '@beyondx/shared'
import { useAuth } from '../auth/AuthProvider'
import { ActionDialog, Badge, Button, ErrorState, PageHeader, Spinner } from '../components/ui'
import { ChangeOrderBadge, JobStatusBadge } from '../components/jobs'
import { FeedbackDialog, RaiseFlagDialog } from '../components/trust'
import { api, errorText } from '../lib/api'
import { dateTime } from '../lib/format'

type Dialog = { kind: 'feedback' | 'flag' } | { kind: 'dispatch' | 'replace'; match: Match } | { kind: 'cancel' | 'change' | 'start' } | { kind: 'confirm'; side: 'employer' | 'xpert' } | null

const PRICE: Record<Match['price'], string> = { within: 'Within their band', above: 'Above their band', below: 'Below their band', no_band: 'No band set' }

export function JobDetailPage() {
  const { id = '' } = useParams()
  const { has } = useAuth()
  const qc = useQueryClient()
  const [dialog, setDialog] = useState<Dialog>(null)
  const q = useQuery({ queryKey: ['job', id], queryFn: () => api<Detail>(`/jobs/${id}`) })
  const refresh = () => Promise.all(['job', 'jobs', 'job-counts', 'jobs-attention', 'change-orders'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
  if (q.isPending) return <Spinner label="Loading the job" />
  if (q.isError) return <ErrorState message={errorText(q.error)} onRetry={() => void q.refetch()} />
  const { job: j, assignments, changeOrders, matches, paymentStatus } = q.data
  const post = (path: string, body?: unknown) => api(`/jobs/${id}${path}`, { method: 'POST', body })
  const dispatchRights = has('dispatch.match')
  const open = j.status === 'awaiting_dispatch' || j.status === 'dispatched' || j.status === 'in_progress'

  return (
    <>
      <Link to="/jobs" className="mb-4 inline-flex min-h-[36px] items-center gap-2 text-sm text-ink-300 hover:text-ink-50"><ArrowLeft className="h-4 w-4" aria-hidden /> Job board</Link>
      <PageHeader title={`${j.category} · ${formatGhs(j.amountGhs)}`} subtitle={`${j.employerName} · ${j.employerPhone} · ${j.location}`} action={<JobStatusBadge status={j.status} />} />
      {j.watch && <p role="status" className="mb-4 rounded-lg border border-amber-600 px-4 py-2 text-sm text-amber-400">{j.watch.label}</p>}

      <section className="card p-4 sm:p-5" aria-labelledby="jd-h">
        <h2 id="jd-h" className="text-sm font-semibold text-ink-50">The job</h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <Item l="When" v={j.timing} />
          <Item l="Xpert" v={j.xpertName ?? (j.xpertId ? j.xpertId : 'Not chosen yet')} />
          <Item l="Payment" v={paymentStatus ? PAYMENT_STATUS_LABELS[paymentStatus] : 'Unknown'} />
          <Item l="Dispatched" v={j.dispatchedAt ? dateTime(j.dispatchedAt) : 'Not yet'} />
          <Item l="Started" v={j.startedAt ? dateTime(j.startedAt) : 'Not yet'} />
          <Item l="Employer confirmed" v={j.employerConfirmedAt ? dateTime(j.employerConfirmedAt) : 'Not yet'} />
          <Item l="Xpert confirmed" v={j.xpertConfirmedAt ? dateTime(j.xpertConfirmedAt) : 'Not yet'} />
          {j.completedAt && <Item l="Completed" v={dateTime(j.completedAt)} />}
          {j.cancelledReason && <Item l="Why it was cancelled" v={j.cancelledReason} />}
        </dl>
        {j.status === 'completed' && paymentStatus === 'released' && <p className="mt-3 text-xs text-ink-300">Both sides confirmed. The payment is marked released. The MoMo payout itself is made by finance.</p>}
        {j.status === 'cancelled' && paymentStatus === 'received' && <p className="mt-3 text-xs text-amber-400">The employer's payment is still held. Whether it is refunded is a decision for finance.</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          {dispatchRights && j.status === 'dispatched' && <Button onClick={() => setDialog({ kind: 'start' })}>Mark as started</Button>}
          {dispatchRights && j.status === 'in_progress' && !j.employerConfirmedAt && <Button variant="secondary" onClick={() => setDialog({ kind: 'confirm', side: 'employer' })}>Log employer confirmation</Button>}
          {dispatchRights && j.status === 'in_progress' && !j.xpertConfirmedAt && <Button variant="secondary" onClick={() => setDialog({ kind: 'confirm', side: 'xpert' })}>Log Xpert confirmation</Button>}
          {has('changeorders.manage') && (j.status === 'dispatched' || j.status === 'in_progress') && <Button variant="secondary" onClick={() => setDialog({ kind: 'change' })}>Log a change order</Button>}
          {has('dispatch.match') && j.status === 'completed' && <Button variant="secondary" onClick={() => setDialog({ kind: 'feedback' })}>Log feedback</Button>}
          {has('flags.raise') && j.xpertId && <Button variant="ghost" onClick={() => setDialog({ kind: 'flag' })}>Raise a flag</Button>}
          {dispatchRights && open && <Button variant="ghost" onClick={() => setDialog({ kind: 'cancel' })}>Cancel job</Button>}
        </div>
      </section>

      {matches.length > 0 && (
        <section className="card mt-6 p-4 sm:p-5" aria-labelledby="mt-h">
          <h2 id="mt-h" className="text-sm font-semibold text-ink-50">{canReplace(j.status) ? 'Possible replacements' : 'Suggested Xperts'}</h2>
          <p className="mt-1 text-xs text-ink-300">Active Xperts who list this category, best fit first. Their current workload and price band are shown.</p>
          <ul className="mt-3 space-y-2">
            {matches.map((m) => (
              <li key={m.xpertId} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-ink-700 p-3">
                <div className="min-w-0 flex-1 basis-48">
                  <Link to={`/xperts/${m.xpertId}`} className="text-sm font-semibold text-ink-50 hover:underline">{m.fullName}</Link>
                  <p className="text-xs text-ink-300">{m.homeArea ?? 'Area not recorded'} · {m.activeJobs} active job{m.activeJobs === 1 ? '' : 's'} · {PRICE[m.price]}{m.band ? ` (${formatGhs(m.band.minGhs)} to ${formatGhs(m.band.maxGhs)})` : ''}</p>
                  {m.notes.length > 0 && <p className="text-xs text-ink-400">{m.notes.join(' ')}</p>}
                </div>
                <Badge tone={m.status === 'full_active' ? 'green' : 'neutral'}>{m.status === 'full_active' ? 'Fully active' : 'Provisionally active'}</Badge>
                {j.status === 'awaiting_dispatch' && dispatchRights && <Button onClick={() => setDialog({ kind: 'dispatch', match: m })}>Dispatch</Button>}
                {canReplace(j.status) && has('jobs.replace') && <Button variant="secondary" onClick={() => setDialog({ kind: 'replace', match: m })}>Replace with this Xpert</Button>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {j.status === 'awaiting_dispatch' && matches.length === 0 && <p className="mt-6 text-sm text-amber-400">No active Xpert lists this category. Check the Xpert pipeline or widen the search by hand.</p>}

      <section className="card mt-6 p-4 sm:p-5" aria-labelledby="as-h">
        <h2 id="as-h" className="text-sm font-semibold text-ink-50">Who has held this job</h2>
        {assignments.length === 0 ? <p className="mt-2 text-sm text-ink-300">Nobody yet.</p> : (
          <ul className="mt-3 space-y-2 text-sm">
            {assignments.map((a) => (
              <li key={a.id} className="flex flex-wrap justify-between gap-2">
                <span className="text-ink-100">{a.xpertName ?? a.xpertId}{a.assignedByName ? ` · chosen by ${a.assignedByName}` : ''}</span>
                <span className="text-ink-300">{a.status === 'active' ? 'On the job now' : a.status === 'replaced' ? `Replaced: ${a.endReason ?? ''}` : a.status === 'completed' ? 'Completed' : `Withdrawn: ${a.endReason ?? ''}`}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {changeOrders.length > 0 && (
        <section className="card mt-6 p-4 sm:p-5" aria-labelledby="co-h">
          <div className="flex items-center justify-between"><h2 id="co-h" className="text-sm font-semibold text-ink-50">Change orders</h2><Link to="/change-orders" className="text-xs text-forest-400 hover:underline">Manage</Link></div>
          <ul className="mt-3 space-y-2 text-sm">
            {changeOrders.map((c) => <li key={c.id} className="flex flex-wrap items-center justify-between gap-2"><span className="text-ink-100">{c.description} ({c.amountDeltaGhs >= 0 ? '+' : ''}{formatGhs(c.amountDeltaGhs)})</span><ChangeOrderBadge status={c.status} /></li>)}
          </ul>
        </section>
      )}

      {dialog?.kind === 'dispatch' && <ActionDialog title={`Dispatch ${dialog.match.fullName}`} description="They will be recorded as the Xpert on this job." confirmLabel="Dispatch" requireReason={false} onClose={() => setDialog(null)} onConfirm={async () => { await post('/dispatch', { xpertId: dialog.match.xpertId }); await refresh() }} />}
      {dialog?.kind === 'replace' && <ActionDialog title={`Replace with ${dialog.match.fullName}`} description="The current Xpert is kept in the history with your reason. The Xpert's own confirmation is cleared." confirmLabel="Replace" onClose={() => setDialog(null)} onConfirm={async (reason) => { await post('/replace', { xpertId: dialog.match.xpertId, reason }); await refresh() }} />}
      {dialog?.kind === 'start' && <ActionDialog title="Mark as started" confirmLabel="Mark as started" requireReason={false} onClose={() => setDialog(null)} onConfirm={async () => { await post('/start'); await refresh() }} />}
      {dialog?.kind === 'confirm' && <ActionDialog title={dialog.side === 'employer' ? 'Log the employer confirmation' : 'Log the Xpert confirmation'} description="When both sides have confirmed, the job completes and the payment is marked released." confirmLabel="Log confirmation" requireReason={false} onClose={() => setDialog(null)} onConfirm={async () => { await post('/confirm', { side: dialog.side }); await refresh() }} />}
      {dialog?.kind === 'cancel' && <ActionDialog title="Cancel this job" description="The payment stays held until finance decides." confirmLabel="Cancel job" danger onClose={() => setDialog(null)} onConfirm={async (reason) => { await post('/cancel', { reason }); await refresh() }} />}
      {dialog?.kind === 'feedback' && <FeedbackDialog jobId={j.id} onClose={() => setDialog(null)} onDone={() => Promise.all([refresh(), qc.invalidateQueries({ queryKey: ['feedback'] }), qc.invalidateQueries({ queryKey: ['reliability'] }), qc.invalidateQueries({ queryKey: ['xperts'] })])} />}
      {dialog?.kind === 'flag' && j.xpertId && <RaiseFlagDialog xpertId={j.xpertId} jobId={j.id} onClose={() => setDialog(null)} onDone={() => qc.invalidateQueries({ queryKey: ['flags'] })} />}
      {dialog?.kind === 'change' && <ChangeDialog jobId={j.id} onClose={() => setDialog(null)} onDone={refresh} />}
    </>
  )
}

function ChangeDialog({ jobId, onClose, onDone }: { jobId: string; onClose: () => void; onDone: () => Promise<unknown> }) {
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('0')
  return (
    <ActionDialog
      title="Log a change order"
      description="Both the employer and the Xpert must confirm it."
      confirmLabel="Log change order"
      requireReason={false}
      onClose={onClose}
      onConfirm={async () => {
        const parsed = changeOrderSchema.safeParse({ jobId, description, amountDeltaGhs: Number(amount) || 0 })
        if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Check the details')
        await api('/change-orders', { method: 'POST', body: parsed.data })
        await onDone()
      }}
    >
      <div><label className="label" htmlFor="co-d">What changed</label><textarea id="co-d" rows={3} className="field" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      <div><label className="label" htmlFor="co-a">Change in price (GHS, can be negative)</label><input id="co-a" type="number" step="0.01" className="field" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
    </ActionDialog>
  )
}

const Item = ({ l, v }: { l: string; v: string }) => (
  <div><dt className="text-xs text-ink-400">{l}</dt><dd className="text-ink-100">{v}</dd></div>
)
