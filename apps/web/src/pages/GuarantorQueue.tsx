import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { type CallbackOutcome, type GuarantorQueueEntry } from '@beyondx/shared'
import { useAuth } from '../auth/AuthProvider'
import { ActionDialog, Badge, Button, EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui'
import { ClaimControl, StatusBadge, Waiting, XpertLink, useRefreshScreening } from '../components/xpert'
import { api, errorText } from '../lib/api'
import { dateTime } from '../lib/format'

export function GuarantorQueue() {
  const { me } = useAuth()
  const refresh = useRefreshScreening()
  const [callback, setCallback] = useState<{ entry: GuarantorQueueEntry; outcome: CallbackOutcome } | null>(null)

  const q = useQuery({ queryKey: ['queue', 'guarantors'], queryFn: () => api<{ entries: GuarantorQueueEntry[] }>('/queues/guarantors') })
  const explainer = useMutation({
    mutationFn: (id: string) => api(`/guarantors/${id}/explainer-sent`, { method: 'POST' }),
    onSuccess: refresh,
  })

  return (
    <>
      <PageHeader
        title="Guarantor queue"
        subtitle="Send the explainer message, then call the guarantor. Confirmation needs both: the message sent and a clear yes on the call. If they hesitate, record it as a no. After two weeks without a confirmation the application closes."
      />
      {q.isPending && <Spinner label="Loading the queue" />}
      {q.isError && <ErrorState message={errorText(q.error)} onRetry={() => void q.refetch()} />}
      {q.data && q.data.entries.length === 0 && <EmptyState title="Nothing waiting" hint="Applicants with a named guarantor appear here." />}
      {explainer.isError && <p role="alert" className="mb-3 text-sm text-danger-400">{errorText(explainer.error)}</p>}

      <ul className="space-y-4">
        {q.data?.entries.map((e) => {
          const g = e.item
          const c = e.countdown
          return (
            <li key={g.id} className="card p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <XpertLink id={e.xpert.id} name={e.xpert.fullName} />
                  <p className="text-sm text-ink-300">{e.xpert.phone}</p>
                </div>
                <div className="flex items-center gap-2">
                  {c && <Badge tone={c.overdue ? 'red' : c.daysLeft <= 3 ? 'amber' : 'neutral'}>{c.label}</Badge>}
                  <StatusBadge status={e.xpert.status} />
                </div>
              </div>

              <div className="mt-4 rounded-lg bg-ink-800/60 p-3 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-300">Guarantor</p>
                <p className="mt-1 font-medium text-ink-50">{g.name}</p>
                <p className="text-ink-200">
                  <a className="underline-offset-2 hover:underline" href={`tel:${g.contact}`}>{g.contact}</a>
                  {g.relationship ? ` · ${g.relationship}` : ''}
                </p>
                <p className="mt-1 text-xs text-ink-400">Named {dateTime(g.namedAt)}</p>
              </div>

              <ol className="mt-4 space-y-3 text-sm">
                <li className="flex flex-wrap items-center gap-3">
                  <span className="w-44 text-ink-200">1. Explainer message</span>
                  {g.explainerMessageSentAt ? (
                    <Badge tone="green">Sent {dateTime(g.explainerMessageSentAt)}</Badge>
                  ) : (
                    <Button variant="secondary" className="min-h-[36px]" busy={explainer.isPending && explainer.variables === g.id} onClick={() => explainer.mutate(g.id)}>
                      Mark as sent
                    </Button>
                  )}
                </li>
                <li className="flex flex-wrap items-center gap-3">
                  <span className="w-44 text-ink-200">2. Callback</span>
                  {g.callbackOutcome && (
                    <Badge tone={g.callbackOutcome === 'yes' ? 'green' : 'amber'}>
                      {g.callbackOutcome === 'yes' ? 'Yes' : g.callbackOutcome === 'no' ? 'No' : 'No response'}
                    </Badge>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button className="min-h-[36px]" disabled={!g.explainerMessageSentAt} onClick={() => setCallback({ entry: e, outcome: 'yes' })}>Said yes</Button>
                    <Button variant="danger" className="min-h-[36px]" onClick={() => setCallback({ entry: e, outcome: 'no' })}>Said no or hesitated</Button>
                    <Button variant="secondary" className="min-h-[36px]" onClick={() => setCallback({ entry: e, outcome: 'no_response' })}>No answer</Button>
                  </div>
                </li>
                {!g.explainerMessageSentAt && <li className="text-xs text-ink-400">A yes can be recorded only after the explainer message is marked as sent.</li>}
              </ol>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-ink-700 pt-3">
                <Waiting since={e.waitingSince} />
                {me && <ClaimControl kind="guarantors" id={g.id} assignedTo={g.assignedTo} assignedToName={g.assignedToName} meId={me.staff.userId} />}
              </div>
            </li>
          )
        })}
      </ul>

      {callback && (
        <CallbackDialog
          entry={callback.entry}
          outcome={callback.outcome}
          onClose={() => setCallback(null)}
          onSaved={refresh}
        />
      )}
    </>
  )
}

function CallbackDialog({ entry, outcome, onClose, onSaved }: { entry: GuarantorQueueEntry; outcome: CallbackOutcome; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const name = entry.item.name
  const copy = {
    yes: { title: `${name} said yes`, text: 'Only record a yes if they clearly said they will stand behind this Xpert. The Xpert moves on to skill verification.', label: 'Record yes', danger: false },
    no: { title: `${name} said no or hesitated`, text: 'This closes the application. Say what they told you.', label: 'Close the application', danger: true },
    no_response: { title: `${name} did not answer`, text: 'The two week clock keeps running. Try again before it runs out.', label: 'Record no answer', danger: false },
  }[outcome]
  return (
    <ActionDialog
      title={copy.title}
      description={copy.text}
      confirmLabel={copy.label}
      danger={copy.danger}
      requireReason={outcome === 'no'}
      reasonLabel="What did they say"
      onClose={onClose}
      onConfirm={async (note) => {
        await api(`/guarantors/${entry.item.id}/callback`, { method: 'POST', body: { outcome, note: note || undefined } })
        await onSaved()
      }}
    />
  )
}
