import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { FLAG_CATEGORY_LABELS, FLAG_OPEN, FLAG_RAISER_LABELS, counterFlagSchema, type FlagDetail as Detail } from '@beyondx/shared'
import { useAuth } from '../auth/AuthProvider'
import { ActionDialog, Button, ErrorState, PageHeader, Spinner } from '../components/ui'
import { FlagStatusBadge, ReliabilityStats } from '../components/trust'
import { api, errorText } from '../lib/api'
import { dateTime } from '../lib/format'

type Dialog = 'counter' | 'upheld' | 'dismissed' | null

export function FlagDetailPage() {
  const { id = '' } = useParams()
  const { has } = useAuth()
  const qc = useQueryClient()
  const [dialog, setDialog] = useState<Dialog>(null)
  const [review, setReview] = useState(false)
  const [by, setBy] = useState<'employer' | 'xpert'>('xpert')
  const [counterText, setCounterText] = useState('')
  const q = useQuery({ queryKey: ['flag', id], queryFn: () => api<Detail>(`/flags/${id}`) })
  const refresh = () => Promise.all(['flag', 'flags', 'reliability', 'xpert', 'xperts', 'trust-counts'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
  if (q.isPending) return <Spinner label="Loading the flag" />
  if (q.isError) return <ErrorState message={errorText(q.error)} onRetry={() => void q.refetch()} />
  const { flag: f, counters, reliability } = q.data
  const open = FLAG_OPEN.includes(f.status)
  return (
    <>
      <Link to="/flags" className="mb-4 inline-flex min-h-[36px] items-center gap-2 text-sm text-ink-300 hover:text-ink-50"><ArrowLeft className="h-4 w-4" aria-hidden /> All flags</Link>
      <PageHeader title={`${f.xpertName ?? f.xpertId}: ${FLAG_CATEGORY_LABELS[f.category]}`} subtitle={`Raised by ${FLAG_RAISER_LABELS[f.raisedBy].toLowerCase()}${f.raisedByStaffName ? `, logged by ${f.raisedByStaffName}` : ''} on ${dateTime(f.createdAt)}`} action={<FlagStatusBadge status={f.status} />} />
      <section className="card p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-ink-50">What was said</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm text-ink-100">{f.detail}</p>
        <p className="mt-3 text-sm"><Link className="text-forest-400 hover:underline" to={`/xperts/${f.xpertId}`}>Open the Xpert's record</Link>{f.jobId && <> · <Link className="text-forest-400 hover:underline" to={`/jobs/${f.jobId}`}>Open the job</Link></>}</p>
        {f.decidedAt && <p className="mt-3 text-sm text-ink-300">Decided {dateTime(f.decidedAt)}{f.decidedByName ? ` by ${f.decidedByName}` : ''}: {f.decisionNote}</p>}
      </section>
      <section className="card mt-6 p-4 sm:p-5" aria-labelledby="cf-h">
        <h2 id="cf-h" className="text-sm font-semibold text-ink-50">Counter flags</h2>
        {counters.length === 0 ? <p className="mt-2 text-sm text-ink-300">None yet.</p> : (
          <ul className="mt-3 space-y-3 text-sm">{counters.map((c) => <li key={c.id}><span className="text-ink-300">{FLAG_RAISER_LABELS[c.raisedBy]}, {dateTime(c.createdAt)}:</span> <span className="text-ink-100">{c.detail}</span></li>)}</ul>
        )}
        {open && has('flags.raise') && <div className="mt-3"><Button variant="secondary" onClick={() => setDialog('counter')}>Add a counter flag</Button></div>}
      </section>
      <section className="card mt-6 p-4 sm:p-5" aria-labelledby="rl-h">
        <h2 id="rl-h" className="mb-3 text-sm font-semibold text-ink-50">This Xpert's record</h2>
        <ReliabilityStats r={reliability} />
      </section>
      {open && has('flags.decide') && (
        <div className="mt-6 flex flex-wrap gap-2">
          {f.status === 'open' && <Button variant="secondary" onClick={async () => { await api(`/flags/${id}/investigate`, { method: 'POST' }); await refresh() }}>Start investigating</Button>}
          <Button onClick={() => { setReview(false); setDialog('upheld') }}>Uphold the flag</Button>
          <Button variant="ghost" onClick={() => setDialog('dismissed')}>Dismiss the flag</Button>
        </div>
      )}
      {dialog === 'counter' && (
        <ActionDialog title="Add a counter flag" description="Their side of what happened." confirmLabel="Add" requireReason={false} onClose={() => setDialog(null)} onConfirm={async () => {
          const parsed = counterFlagSchema.safeParse({ raisedBy: by, detail: counterText })
          if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Check the details')
          await api(`/flags/${id}/counter`, { method: 'POST', body: parsed.data }); setCounterText(''); await refresh()
        }}>
          <div><label className="label" htmlFor="cf-b">Whose account</label><select id="cf-b" className="field" value={by} onChange={(e) => setBy(e.target.value as 'employer' | 'xpert')}><option value="xpert">The Xpert</option><option value="employer">The employer</option></select></div>
          <div><label className="label" htmlFor="cf-d">What they say</label><textarea id="cf-d" rows={4} className="field" value={counterText} onChange={(e) => setCounterText(e.target.value)} /></div>
        </ActionDialog>
      )}
      {(dialog === 'upheld' || dialog === 'dismissed') && (
        <ActionDialog title={dialog === 'upheld' ? 'Uphold this flag' : 'Dismiss this flag'} reasonLabel="Your decision, and why" confirmLabel={dialog === 'upheld' ? 'Uphold' : 'Dismiss'} danger={dialog === 'upheld'} onClose={() => setDialog(null)} onConfirm={async (note) => {
          await api(`/flags/${id}/decide`, { method: 'POST', body: { outcome: dialog, note, sendToReview: dialog === 'upheld' && review } }); await refresh()
        }}>
          {dialog === 'upheld' && has('xperts.status.decide') && (
            <label className="flex items-start gap-2 text-sm text-ink-100"><input type="checkbox" className="mt-1" checked={review} onChange={(e) => setReview(e.target.checked)} /> Also send this Xpert to Under Review</label>
          )}
          <p className="text-xs text-ink-300">Counter flags are marked as reviewed with this decision. An upheld flag also means the job it was about no longer counts as clean.</p>
        </ActionDialog>
      )}
    </>
  )
}
