import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { QueueEntry, ReferenceRecord, ScreeningConfigResponse } from '@beyondx/shared'
import { useAuth } from '../auth/AuthProvider'
import { Badge, Button, EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui'
import { ClaimControl, Waiting, XpertLink, useRefreshScreening } from '../components/xpert'
import { api, errorText } from '../lib/api'
import { dateTime } from '../lib/format'

export function ReferenceQueue() {
  const { me } = useAuth()
  const q = useQuery({ queryKey: ['queue', 'references'], queryFn: () => api<{ entries: QueueEntry<ReferenceRecord>[] }>('/queues/references') })
  const script = useQuery({ queryKey: ['reference-script'], queryFn: () => api<{ lines: string[]; isStarter: boolean }>('/references/script') })
  const cfg = useQuery({ queryKey: ['screening-config'], queryFn: () => api<ScreeningConfigResponse>('/config').catch(() => null) })
  const maxAttempts = cfg.data?.config.referenceUnreachableAttempts ?? 3

  return (
    <>
      <PageHeader
        title="Reference calls"
        subtitle="Call the reference using the script, then log what happened. A reference who cannot be reached is only marked unreachable after several tries. A reference cannot be family or the guarantor."
      />
      {q.isPending && <Spinner label="Loading the queue" />}
      {q.isError && <ErrorState message={errorText(q.error)} onRetry={() => void q.refetch()} />}
      {q.data && q.data.entries.length === 0 && <EmptyState title="Nothing waiting" hint="References added to an Xpert's record appear here until they are confirmed or closed." />}
      <ul className="space-y-4">
        {q.data?.entries.map((e) => (
          <li key={e.item.id} className="card p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <XpertLink id={e.xpert.id} name={e.xpert.fullName} />
                <p className="text-sm text-ink-300">Reference for this Xpert</p>
              </div>
              <Badge tone={e.item.attemptsMade > 0 ? 'amber' : 'neutral'}>Calls so far: {e.item.attemptsMade} of {maxAttempts}</Badge>
            </div>
            <div className="mt-3 grid gap-4 lg:grid-cols-2">
              <div>
                <div className="rounded-lg bg-ink-800/60 p-3 text-sm">
                  <p className="font-medium text-ink-50">{e.item.name}</p>
                  <p className="text-ink-200">
                    <a className="underline-offset-2 hover:underline" href={`tel:${e.item.contact}`}>{e.item.contact}</a> · {e.item.relationship}
                  </p>
                  {e.item.calledAt && <p className="mt-1 text-xs text-ink-400">Last call {dateTime(e.item.calledAt)}{e.item.calledByName ? ` by ${e.item.calledByName}` : ''}</p>}
                </div>
                {e.item.warnings.length > 0 && (
                  <ul className="mt-3 space-y-1" aria-label="Warnings">
                    {e.item.warnings.map((w) => (
                      <li key={w} className="rounded-md bg-clay-600/20 px-3 py-2 text-xs text-clay-200">{w}</li>
                    ))}
                  </ul>
                )}
                <CallForm reference={e.item} />
              </div>
              <div className="rounded-lg border border-ink-700 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-300">Call script</p>
                {script.isPending && <Spinner label="Loading the script" />}
                {script.isError && <p className="mt-2 text-sm text-danger-400">{errorText(script.error)}</p>}
                {script.data && (
                  <>
                    {script.data.isStarter && <p className="mt-2 rounded-md bg-clay-600/20 px-3 py-2 text-xs text-clay-200">Starter script. The real script has not been set up yet. A super admin can add it in Settings.</p>}
                    <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-ink-100">
                      {script.data.lines.map((l) => <li key={l}>{l}</li>)}
                    </ol>
                  </>
                )}
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-ink-700 pt-3">
              <Waiting since={e.waitingSince} />
              {me && <ClaimControl kind="references" id={e.item.id} assignedTo={e.item.assignedTo} assignedToName={e.item.assignedToName} meId={me.staff.userId} />}
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}

export function CallForm({ reference }: { reference: ReferenceRecord }) {
  const refresh = useRefreshScreening()
  const [note, setNote] = useState('')
  const log = useMutation({
    mutationFn: (result: 'confirmed' | 'inconclusive' | 'not_reached') => api(`/references/${reference.id}/calls`, { method: 'POST', body: { result, note: note.trim() || undefined } }),
    onSuccess: async () => {
      setNote('')
      await refresh()
    },
  })
  return (
    <div className="mt-3">
      <label className="label" htmlFor={`note-${reference.id}`}>What happened on the call</label>
      <textarea id={`note-${reference.id}`} rows={3} className="field" value={note} onChange={(e) => setNote(e.target.value)} />
      {log.isError && <p role="alert" className="mt-2 text-sm text-danger-400">{errorText(log.error)}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button className="min-h-[36px]" busy={log.isPending} onClick={() => log.mutate('confirmed')}>Confirmed the Xpert</Button>
        <Button variant="secondary" className="min-h-[36px]" busy={log.isPending} onClick={() => log.mutate('inconclusive')}>Inconclusive</Button>
        <Button variant="secondary" className="min-h-[36px]" busy={log.isPending} onClick={() => log.mutate('not_reached')}>Could not reach</Button>
      </div>
    </div>
  )
}
