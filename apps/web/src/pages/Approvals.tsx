import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { VERIFICATION_SOURCES, VERIFICATION_SOURCE_LABELS, type ApprovalQueueEntry, type VerificationSource } from '@beyondx/shared'
import { useAuth } from '../auth/AuthProvider'
import { ActionDialog, Badge, Button, EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui'
import { Waiting, XpertLink, useRefreshScreening } from '../components/xpert'
import { api, errorText } from '../lib/api'

export function Approvals() {
  const { has } = useAuth()
  const refresh = useRefreshScreening()
  const [target, setTarget] = useState<ApprovalQueueEntry | null>(null)
  const q = useQuery({ queryKey: ['queue', 'approvals'], queryFn: () => api<{ entries: ApprovalQueueEntry[] }>('/queues/approvals') })
  const canApprove = has('xperts.approve')

  return (
    <>
      <PageHeader
        title="Approvals"
        subtitle="Xperts in skill verification. Approving switches their account on at the provisional level. It needs a confirmed guarantor and at least one piece of passed evidence, with nothing left waiting for review."
      />
      {q.isPending && <Spinner label="Loading the queue" />}
      {q.isError && <ErrorState message={errorText(q.error)} onRetry={() => void q.refetch()} />}
      {q.data && q.data.entries.length === 0 && <EmptyState title="Nobody is in skill verification" hint="Xperts appear here once their guarantor is confirmed." />}
      <ul className="space-y-4">
        {q.data?.entries.map((e) => (
          <li key={e.xpert.id} className="card p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <XpertLink id={e.xpert.id} name={e.xpert.fullName} />
                <p className="text-sm text-ink-300">{e.xpert.phone}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {e.nudgeDue && <Badge tone="amber">Two weeks in screening, chase it up</Badge>}
                <Badge tone={e.ready ? 'green' : 'neutral'}>{e.ready ? 'Ready to approve' : 'Not ready'}</Badge>
              </div>
            </div>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-lg bg-ink-800/60 p-3">
                <dt className="text-xs font-semibold uppercase tracking-wide text-ink-300">Guarantor</dt>
                <dd className="mt-1 text-ink-100">{e.guarantor ? `${e.guarantor.name}, ${e.guarantor.callbackOutcome === 'yes' ? 'confirmed' : 'not confirmed'}` : 'None on record'}</dd>
              </div>
              <div className="rounded-lg bg-ink-800/60 p-3">
                <dt className="text-xs font-semibold uppercase tracking-wide text-ink-300">Skill evidence</dt>
                <dd className="mt-1 text-ink-100">{e.evidence.passed} passed, {e.evidence.pending} waiting, {e.evidence.failed} failed</dd>
              </div>
            </dl>
            {e.gaps.length > 0 && (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-200">{e.gaps.map((g) => <li key={g}>{g}</li>)}</ul>
            )}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-ink-700 pt-3">
              <Waiting since={e.waitingSince} />
              {canApprove ? (
                <Button disabled={!e.ready} onClick={() => setTarget(e)}>Approve</Button>
              ) : (
                <span className="text-xs text-ink-400">Only a decision maker can approve.</span>
              )}
            </div>
          </li>
        ))}
      </ul>
      {target && <ApproveDialog entry={target} onClose={() => setTarget(null)} onDone={refresh} />}
    </>
  )
}

export function ApproveDialog({ entry, onClose, onDone }: { entry: { xpert: { id: string; fullName: string } }; onClose: () => void; onDone: () => Promise<unknown> }) {
  const [source, setSource] = useState<VerificationSource | ''>('')
  return (
    <ActionDialog
      title={`Approve ${entry.xpert.fullName}`}
      description="Their account switches on at the provisional level. Record who did the verification, so it is clear later."
      confirmLabel="Approve"
      requireReason={false}
      onClose={onClose}
      onConfirm={async () => {
        if (!source) throw new Error('Choose who verified this Xpert.')
        await api(`/xperts/${encodeURIComponent(entry.xpert.id)}/approve`, { method: 'POST', body: { verificationSource: source } })
        await onDone()
      }}
    >
      <div>
        <label className="label" htmlFor="vs">Verified by</label>
        <select id="vs" className="field" value={source} onChange={(e) => setSource(e.target.value as VerificationSource | '')}>
          <option value="">Choose one</option>
          {VERIFICATION_SOURCES.map((s) => <option key={s} value={s}>{VERIFICATION_SOURCE_LABELS[s]}</option>)}
        </select>
      </div>
    </ActionDialog>
  )
}
