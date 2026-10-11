import { useMutation, useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { evidenceVerdict, type EvidenceChecklist, type EvidenceRecord, type QueueEntry } from '@beyondx/shared'
import { useAuth } from '../auth/AuthProvider'
import { Badge, Button, EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui'
import { ClaimControl, Waiting, XpertLink, useRefreshScreening } from '../components/xpert'
import { api, errorText } from '../lib/api'

export function EvidenceQueue() {
  const { me } = useAuth()
  const [open, setOpen] = useState<string | null>(null)
  const q = useQuery({ queryKey: ['queue', 'evidence'], queryFn: () => api<{ entries: QueueEntry<EvidenceRecord>[] }>('/queues/evidence') })

  return (
    <>
      <PageHeader
        title="Evidence review"
        subtitle="Open the evidence, then work down the checklist. A pass needs every item ticked. Anything in the automatic fail list fails the evidence on its own. There are no scores, only pass or fail."
      />
      {q.isPending && <Spinner label="Loading the queue" />}
      {q.isError && <ErrorState message={errorText(q.error)} onRetry={() => void q.refetch()} />}
      {q.data && q.data.entries.length === 0 && <EmptyState title="Nothing waiting" hint="Evidence added to an Xpert's record appears here." />}
      <ul className="space-y-4">
        {q.data?.entries.map((e) => (
          <li key={e.item.id} className="card p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <XpertLink id={e.xpert.id} name={e.xpert.fullName} />
                <p className="text-sm text-ink-300">{e.item.taskType}</p>
              </div>
              <Badge tone={e.item.evidenceType === 'certification' ? 'green' : 'neutral'}>
                {e.item.evidenceType === 'certification' ? 'Certification' : 'Submitted evidence'}
              </Badge>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <EvidenceOpen evidence={e.item} />
                <Waiting since={e.waitingSince} />
              </div>
              {me && <ClaimControl kind="evidence" id={e.item.id} assignedTo={e.item.assignedTo} assignedToName={e.item.assignedToName} meId={me.staff.userId} />}
            </div>
            <div className="mt-3">
              {open === e.item.id ? (
                <ReviewPanel evidence={e.item} onDone={() => setOpen(null)} />
              ) : (
                <Button variant="secondary" onClick={() => setOpen(e.item.id)}>Review this</Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}

/** Opens a link, or fetches a short lived address for an uploaded file. */
export function EvidenceOpen({ evidence }: { evidence: EvidenceRecord }) {
  const open = useMutation({
    mutationFn: () => api<{ url: string }>(`/evidence/${evidence.id}/file-url`),
    onSuccess: (r) => window.open(r.url, '_blank', 'noopener,noreferrer'),
  })
  if (evidence.link) {
    return (
      <a href={evidence.link} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[36px] items-center gap-2 rounded-lg border border-ink-600 px-3 text-sm text-ink-100 hover:bg-ink-800">
        <ExternalLink className="h-4 w-4" aria-hidden /> Open the link
      </a>
    )
  }
  return (
    <span className="inline-flex items-center gap-2">
      <Button variant="secondary" className="min-h-[36px]" busy={open.isPending} onClick={() => open.mutate()}>
        <ExternalLink className="h-4 w-4" aria-hidden /> Open the file
      </Button>
      {open.isError && <span role="alert" className="text-xs text-danger-400">{errorText(open.error)}</span>}
    </span>
  )
}

function ReviewPanel({ evidence, onDone }: { evidence: EvidenceRecord; onDone: () => void }) {
  const refresh = useRefreshScreening()
  const cl = useQuery({
    queryKey: ['checklist', evidence.id],
    queryFn: () => api<{ checklist: EvidenceChecklist; isStarter: boolean }>(`/evidence/${evidence.id}/checklist`),
  })
  const [ticked, setTicked] = useState<Record<string, boolean>>({})
  const [hits, setHits] = useState<string[]>([])
  const [reason, setReason] = useState('')
  const save = useMutation({
    mutationFn: (outcome: 'pass' | 'fail') => api(`/evidence/${evidence.id}/review`, { method: 'POST', body: { outcome, ticked, autoFailHits: hits, reason: reason.trim() || undefined } }),
    onSuccess: async () => {
      await refresh()
      onDone()
    },
  })

  if (cl.isPending) return <Spinner label="Loading the checklist" />
  if (cl.isError) return <ErrorState message={errorText(cl.error)} onRetry={() => void cl.refetch()} />
  const { checklist, isStarter } = cl.data
  const verdict = evidenceVerdict({ checklist, ticked, autoFailHits: hits })

  return (
    <div className="rounded-lg border border-ink-700 bg-ink-800/40 p-4">
      {isStarter && (
        <p className="mb-3 rounded-md bg-clay-600/20 px-3 py-2 text-xs text-clay-200">
          This is a starter checklist. The real checklist for {evidence.taskType} has not been set up yet. A super admin can add it in Settings.
        </p>
      )}
      <fieldset>
        <legend className="text-xs font-semibold uppercase tracking-wide text-ink-300">Checklist</legend>
        <div className="mt-2 space-y-2">
          {checklist.items.map((i) => (
            <label key={i.id} className="flex min-h-[36px] cursor-pointer items-start gap-3 text-sm text-ink-100">
              <input type="checkbox" className="mt-1 h-4 w-4 accent-forest-600" checked={!!ticked[i.id]} onChange={(e) => setTicked({ ...ticked, [i.id]: e.target.checked })} />
              {i.label}
            </label>
          ))}
        </div>
      </fieldset>
      {checklist.autoFail.length > 0 && (
        <fieldset className="mt-4 rounded-lg border border-danger-700/50 p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-danger-400">Automatic fail</legend>
          <div className="space-y-2">
            {checklist.autoFail.map((a) => (
              <label key={a.id} className="flex min-h-[36px] cursor-pointer items-start gap-3 text-sm text-ink-100">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-danger-600"
                  checked={hits.includes(a.id)}
                  onChange={(e) => setHits(e.target.checked ? [...hits, a.id] : hits.filter((h) => h !== a.id))}
                />
                {a.label}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="mt-4">
        <label className="label" htmlFor={`why-${evidence.id}`}>Note {verdict.allowedOutcome === 'fail' ? '(say why it fails)' : '(optional)'}</label>
        <textarea id={`why-${evidence.id}`} rows={2} className="field" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      {verdict.allowedOutcome === 'fail' && verdict.reasons.length > 0 && <p className="mt-3 text-xs text-ink-300">{verdict.reasons.join(' ')}</p>}
      {save.isError && <p role="alert" className="mt-3 text-sm text-danger-400">{errorText(save.error)}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button busy={save.isPending} disabled={verdict.allowedOutcome !== 'pass'} onClick={() => save.mutate('pass')}>Pass</Button>
        <Button variant="danger" busy={save.isPending} disabled={reason.trim().length < 3 && verdict.allowedOutcome === 'pass'} onClick={() => save.mutate('fail')}>Fail</Button>
        <Button variant="ghost" onClick={onDone}>Close</Button>
      </div>
    </div>
  )
}
