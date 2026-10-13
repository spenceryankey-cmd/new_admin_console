import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  NOTIFICATION_AUDIENCES,
  NOTIFICATION_AUDIENCE_LABELS,
  NOTIFICATION_BODY_MAX,
  type NotificationAudience,
  type NotificationAudienceKind,
  type NotificationPreview,
  type NotificationSendRecord,
} from '@beyondx/shared'
import { ActionDialog, Badge, Button, EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui'
import { CategorySelect } from '../components/catalogue'
import { api, errorText } from '../lib/api'
import { dateTime } from '../lib/format'

const STATUS_TONE = { sent: 'green', partial: 'amber', failed: 'red' } as const
const STATUS_LABEL = { sent: 'Sent', partial: 'Partly delivered', failed: 'Not delivered' } as const

function audienceFrom(kind: NotificationAudienceKind, id: string, category: string): NotificationAudience | null {
  if (kind === 'xpert' || kind === 'employer') return id.trim() ? { kind, id: id.trim() } : null
  if (kind === 'xperts_in_category') return category ? { kind, category } : null
  return { kind }
}

export function SendNotification() {
  const qc = useQueryClient()
  const [kind, setKind] = useState<NotificationAudienceKind>('all_xperts')
  const [id, setId] = useState('')
  const [category, setCategory] = useState('')
  const [body, setBody] = useState('')
  const [preview, setPreview] = useState<NotificationPreview | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  const audience = audienceFrom(kind, id, category)
  const history = useQuery({ queryKey: ['notification-history'], queryFn: () => api<{ sends: NotificationSendRecord[]; total: number }>('/notifications/history?limit=20') })

  // Changing who it goes to means the count that was shown is no longer true.
  const changeAudience = (fn: () => void) => { fn(); setPreview(null); setError(null); setDone(null) }

  async function check() {
    if (!audience) return
    setChecking(true)
    setError(null)
    setDone(null)
    try {
      setPreview(await api<NotificationPreview>('/notifications/preview', { method: 'POST', body: { audience } }))
    } catch (e) {
      setPreview(null)
      setError(errorText(e))
    }
    setChecking(false)
  }

  const ready = !!audience && !!preview && preview.recipients > 0 && body.trim().length >= 3 && body.length <= NOTIFICATION_BODY_MAX

  return (
    <>
      <PageHeader title="Send a notification" subtitle="Appears in the bell inside the Xpert and employer dashboards. Automatic notifications for offers, jobs and payments keep working on their own. Every send is recorded with the exact words." />

      <div className="card max-w-xl space-y-4 p-5">
        <div>
          <label className="label" htmlFor="n-aud">Who should get it</label>
          <select id="n-aud" className="field" value={kind} onChange={(e) => changeAudience(() => setKind(e.target.value as NotificationAudienceKind))}>
            {NOTIFICATION_AUDIENCES.map((k) => <option key={k} value={k}>{NOTIFICATION_AUDIENCE_LABELS[k]}</option>)}
          </select>
        </div>
        {(kind === 'xpert' || kind === 'employer') && (
          <div>
            <label className="label" htmlFor="n-id">{kind === 'xpert' ? 'Xpert id' : 'Employer id'}</label>
            <input id="n-id" className="field" value={id} onChange={(e) => changeAudience(() => setId(e.target.value))} />
            <p className="mt-1 text-xs text-ink-400">{kind === 'xpert' ? 'Copy it from the Xpert record page.' : 'Copy it from the request or job.'}</p>
          </div>
        )}
        {kind === 'xperts_in_category' && (
          <div>
            <label className="label" htmlFor="n-cat">Category</label>
            <CategorySelect id="n-cat" value={category} onChange={(v) => changeAudience(() => setCategory(v))} />
          </div>
        )}

        <div>
          <label className="label" htmlFor="n-body">Message</label>
          <textarea id="n-body" rows={4} className="field" maxLength={NOTIFICATION_BODY_MAX} value={body} onChange={(e) => { setBody(e.target.value); setDone(null) }} />
          <p className="mt-1 text-xs text-ink-400">{body.length} of {NOTIFICATION_BODY_MAX} characters</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" busy={checking} disabled={!audience} onClick={() => void check()}>Check who will get it</Button>
          {preview && (
            <p role="status" className="text-sm text-ink-100">
              {preview.recipients === 0 ? 'No one matches that audience.' : `This will reach ${preview.recipients} ${preview.recipients === 1 ? 'person' : 'people'}${preview.sample.length ? `, including ${preview.sample.join(', ')}` : ''}.`}
            </p>
          )}
        </div>
        {error && <p role="alert" className="text-sm text-danger-400">{error}</p>}
        {done && <p role="status" className="text-sm text-forest-300">{done}</p>}

        <Button disabled={!ready} onClick={() => setConfirming(true)}>{preview && preview.recipients > 0 ? `Send to ${preview.recipients} ${preview.recipients === 1 ? 'person' : 'people'}` : 'Send'}</Button>
      </div>

      {confirming && audience && preview && (
        <ActionDialog
          title="Send this notification"
          description={`It will go to ${preview.recipients} ${preview.recipients === 1 ? 'person' : 'people'} and cannot be taken back.`}
          confirmLabel="Send now"
          requireReason={false}
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            try {
              const sent = await api<NotificationSendRecord>('/notifications/send', { method: 'POST', body: { audience, body: body.trim(), confirmRecipients: preview.recipients } })
              setDone(sent.status === 'partial' ? `Delivered to ${sent.deliveredCount} of ${sent.recipientCount} people.` : `Sent to ${sent.recipientCount} ${sent.recipientCount === 1 ? 'person' : 'people'}.`)
              setBody('')
              setPreview(null)
            } finally {
              await qc.invalidateQueries({ queryKey: ['notification-history'] })
            }
          }}
        >
          <p className="whitespace-pre-wrap rounded-lg bg-ink-800 p-3 text-sm text-ink-50">{body.trim()}</p>
        </ActionDialog>
      )}

      <h2 className="mb-3 mt-8 text-lg font-semibold text-ink-50">Sent from the console</h2>
      {history.isPending && <Spinner label="Loading history" />}
      {history.isError && <ErrorState message={errorText(history.error)} onRetry={() => void history.refetch()} />}
      {history.data && history.data.sends.length === 0 && <EmptyState title="Nothing sent yet" />}
      {history.data && history.data.sends.length > 0 && (
        <ul className="space-y-3">
          {history.data.sends.map((s) => (
            <li key={s.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-sm font-semibold text-ink-50">{NOTIFICATION_AUDIENCE_LABELS[s.audienceKind]}{s.audienceDetail ? ` · ${s.audienceDetail}` : ''}</p>
                <Badge tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Badge>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-ink-100">{s.body}</p>
              <p className="mt-1 text-xs text-ink-400">{s.deliveredCount} of {s.recipientCount} delivered · {dateTime(s.createdAt)}{s.sentByName ? ` · ${s.sentByName}` : ''}{s.error ? ` · ${s.error}` : ''}</p>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
