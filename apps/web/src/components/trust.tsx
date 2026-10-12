import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FEEDBACK_REASON_GROUPS, FEEDBACK_REASON_LABELS, FLAG_CATEGORIES, FLAG_CATEGORY_LABELS, FLAG_STATUS_LABELS, LOW_RATING_MAX, feedbackSchema, raiseFlagSchema, taskTypesFor, type FeedbackInput, type FeedbackReason, type FlagCategory, type FlagRecord, type FlagStatus, type ReliabilityRecord } from '@beyondx/shared'
import { useAuth } from '../auth/AuthProvider'
import { ActionDialog, Badge, Button, ErrorState, Spinner } from './ui'
import { api, errorText } from '../lib/api'

const TONE: Record<FlagStatus, 'neutral' | 'green' | 'amber' | 'red'> = { open: 'amber', investigating: 'amber', upheld: 'red', dismissed: 'neutral', reviewed: 'neutral' }
export const FlagStatusBadge = ({ status }: { status: FlagStatus }) => <Badge tone={TONE[status]}>{FLAG_STATUS_LABELS[status]}</Badge>

const pct = (n: number | null) => (n === null ? 'No data yet' : `${Math.round(n * 100)}%`)

export function ReliabilityStats({ r }: { r: ReliabilityRecord }) {
  const cells: [string, string][] = [
    ['Jobs completed', String(r.jobsCompleted)],
    ['Clean jobs', String(r.cleanJobs)],
    ['Average rating', r.avgRating === null ? 'No data yet' : `${r.avgRating} of 5`],
    ['On time', pct(r.onTimeRate)],
    ['Replaced on a job', String(r.timesReplaced)],
    ['Jobs withdrawn', String(r.jobsWithdrawn)],
    ['Flags upheld', String(r.flagsUpheld)],
    ['Flags open', String(r.flagsOpen)],
  ]
  return (
    <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
      {cells.map(([l, v]) => (
        <div key={l}><dt className="text-xs text-ink-400">{l}</dt><dd className="text-lg font-semibold text-ink-50">{v}</dd></div>
      ))}
    </dl>
  )
}

/** Reliability record and flags for one Xpert. Everything shown is computed from the records. */
export function XpertTrustCard({ xpertId }: { xpertId: string }) {
  const { has } = useAuth()
  const [raising, setRaising] = useState(false)
  const rel = useQuery({ queryKey: ['reliability', xpertId], queryFn: () => api<{ reliability: ReliabilityRecord }>(`/reliability/${encodeURIComponent(xpertId)}`), enabled: has('reliability.read') })
  const flags = useQuery({ queryKey: ['flags', 'xpert', xpertId], queryFn: () => api<{ flags: FlagRecord[] }>(`/flags?xpertId=${encodeURIComponent(xpertId)}`), enabled: has('flags.read') })
  if (!has('reliability.read') && !has('flags.read')) return null
  return (
    <section className="card mt-6 p-4 sm:p-5" aria-labelledby="rel-h">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="rel-h" className="text-sm font-semibold text-ink-50">Reliability record</h2>
        {has('flags.raise') && <Button variant="secondary" onClick={() => setRaising(true)}>Raise a flag</Button>}
      </div>
      <p className="mt-1 text-xs text-ink-300">Worked out from jobs, feedback and flags. Nothing here is typed in by hand.</p>
      <div className="mt-3">
        {rel.isPending && has('reliability.read') && <Spinner label="Loading" />}
        {rel.isError && <ErrorState message={errorText(rel.error)} onRetry={() => void rel.refetch()} />}
        {rel.data && <ReliabilityStats r={rel.data.reliability} />}
      </div>
      {flags.data && flags.data.flags.length > 0 && (
        <ul className="mt-4 space-y-2 border-t border-ink-700 pt-3 text-sm">
          {flags.data.flags.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2">
              <Link to={`/flags/${f.id}`} className="text-ink-100 hover:underline">{FLAG_CATEGORY_LABELS[f.category]}: {f.detail.length > 70 ? `${f.detail.slice(0, 70)}...` : f.detail}</Link>
              <FlagStatusBadge status={f.status} />
            </li>
          ))}
        </ul>
      )}
      {raising && <RaiseFlagDialog xpertId={xpertId} onClose={() => setRaising(false)} />}
    </section>
  )
}

export function RaiseFlagDialog({ xpertId, jobId, onClose, onDone }: { xpertId: string; jobId?: string; onClose: () => void; onDone?: () => Promise<unknown> }) {
  const [category, setCategory] = useState<FlagCategory>('quality')
  const [raisedBy, setRaisedBy] = useState('employer')
  const [detail, setDetail] = useState('')
  return (
    <ActionDialog
      title="Raise a flag"
      description="A decision maker will look into it. Add what the other side says afterwards as a counter flag."
      confirmLabel="Raise flag"
      requireReason={false}
      onClose={onClose}
      onConfirm={async () => {
        const parsed = raiseFlagSchema.safeParse({ xpertId, jobId, raisedBy, category, detail })
        if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Check the details')
        await api('/flags', { method: 'POST', body: parsed.data })
        await onDone?.()
      }}
    >
      <div><label className="label" htmlFor="fl-c">What kind of concern</label><select id="fl-c" className="field" value={category} onChange={(e) => setCategory(e.target.value as FlagCategory)}>{FLAG_CATEGORIES.map((c) => <option key={c} value={c}>{FLAG_CATEGORY_LABELS[c]}</option>)}</select></div>
      <div><label className="label" htmlFor="fl-b">Who is raising it</label><select id="fl-b" className="field" value={raisedBy} onChange={(e) => setRaisedBy(e.target.value)}><option value="employer">The employer</option><option value="xpert">The Xpert</option><option value="staff">Our own staff</option></select></div>
      <div><label className="label" htmlFor="fl-d">What happened</label><textarea id="fl-d" rows={4} className="field" value={detail} onChange={(e) => setDetail(e.target.value)} /></div>
    </ActionDialog>
  )
}

export function FeedbackDialog({ jobId, category, onClose, onDone }: { jobId: string; category: string; onClose: () => void; onDone: () => Promise<unknown> }) {
  const [side, setSide] = useState<'employer' | 'xpert'>('employer')
  const [rating, setRating] = useState('5')
  const [onTime, setOnTime] = useState('yes')
  const [again, setAgain] = useState('unknown')
  const [comment, setComment] = useState('')
  const [reasons, setReasons] = useState<FeedbackReason[]>([])
  const [task, setTask] = useState('')
  const tasks = taskTypesFor(category)
  const toggle = (r: FeedbackReason) => setReasons((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]))
  const tri = (v: string) => (v === 'yes' ? true : v === 'no' ? false : null)
  return (
    <ActionDialog
      title="Log feedback"
      description="Ratings from the employer count towards clean jobs. Feedback from the Xpert is kept on record."
      confirmLabel="Save feedback"
      requireReason={false}
      onClose={onClose}
      onConfirm={async () => {
        const parsed = feedbackSchema.safeParse({ jobId, side, rating: Number(rating), onTime: tri(onTime), wouldRepeat: tri(again), reasons, taskTypeCode: task || null, comment: comment || undefined } satisfies Partial<FeedbackInput>)
        if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Check the details')
        await api('/feedback', { method: 'POST', body: parsed.data })
        await onDone()
      }}
    >
      <div><label className="label" htmlFor="fb-s">Whose feedback</label><select id="fb-s" className="field" value={side} onChange={(e) => setSide(e.target.value as 'employer' | 'xpert')}><option value="employer">The employer</option><option value="xpert">The Xpert</option></select></div>
      <div><label className="label" htmlFor="fb-r">Rating, 1 to 5</label><select id="fb-r" className="field" value={rating} onChange={(e) => setRating(e.target.value)}>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
      <div><label className="label" htmlFor="fb-t">On time</label><select id="fb-t" className="field" value={onTime} onChange={(e) => setOnTime(e.target.value)}><option value="yes">Yes</option><option value="no">No</option><option value="unknown">Not said</option></select></div>
      <div><label className="label" htmlFor="fb-a">Would use again</label><select id="fb-a" className="field" value={again} onChange={(e) => setAgain(e.target.value)}><option value="yes">Yes</option><option value="no">No</option><option value="unknown">Not said</option></select></div>
      {tasks.length > 0 && (
        <div><label className="label" htmlFor="fb-k">Task type (optional)</label><select id="fb-k" className="field" value={task} onChange={(e) => setTask(e.target.value)}><option value="">Not said</option>{tasks.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}</select></div>
      )}
      <fieldset>
        <legend className="label">Reasons{Number(rating) <= LOW_RATING_MAX ? ' (choose at least one)' : ' (optional)'}</legend>
        <div className="grid gap-1 sm:grid-cols-2">
          {([...FEEDBACK_REASON_GROUPS.good, ...FEEDBACK_REASON_GROUPS.concern] as FeedbackReason[]).map((r) => (
            <label key={r} className="flex min-h-[36px] items-center gap-2 text-sm text-ink-100"><input type="checkbox" checked={reasons.includes(r)} onChange={() => toggle(r)} />{FEEDBACK_REASON_LABELS[r]}</label>
          ))}
        </div>
      </fieldset>
      <div><label className="label" htmlFor="fb-c">Comment (optional)</label><textarea id="fb-c" rows={2} className="field" value={comment} onChange={(e) => setComment(e.target.value)} /></div>
    </ActionDialog>
  )
}
