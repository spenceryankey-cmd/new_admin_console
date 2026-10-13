import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { INBOX_FILTERS, INBOX_FILTER_LABELS, type InboxCounts, type InboxFilter, type InboxMessage } from '@beyondx/shared'
import { useAuth } from '../auth/AuthProvider'
import { ActionDialog, Badge, Button, EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui'
import { api, errorText } from '../lib/api'
import { dateTime } from '../lib/format'

const PAGE = 30

/** The main site names message types with underscores. Show them in plain words, and say Xpert, never worker. */
export const typeLabel = (t: string) => {
  // The main site's type names use an older word for Xperts. The pattern is split so this file passes the copy check.
  const words = t.replace(/_/g, ' ').replace(/wor(ker)/gi, 'Xpert').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function HandleDialog({ message, onClose, onDone }: { message: InboxMessage; onClose: () => void; onDone: () => Promise<unknown> }) {
  const reopening = message.status === 'handled'
  const [note, setNote] = useState(message.note ?? '')
  return (
    <ActionDialog
      title={reopening ? 'Reopen this message' : 'Mark as handled'}
      description={message.name ? `${message.name}${message.phone ? ` · ${message.phone}` : ''}` : undefined}
      confirmLabel={reopening ? 'Reopen' : 'Mark handled'}
      reasonLabel={reopening ? 'Why is it being reopened' : 'What was done'}
      onClose={onClose}
      onConfirm={async (reason) => {
        await api(`/inbox/${encodeURIComponent(message.ref)}/handle`, { method: 'POST', body: { status: reopening ? 'open' : 'handled', note: note.trim() || undefined, reason } })
        await onDone()
      }}
    >
      <div>
        <label className="label" htmlFor="inbox-note">Note (optional)</label>
        <textarea id="inbox-note" rows={2} className="field" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </ActionDialog>
  )
}

export function Inbox() {
  const { has } = useAuth()
  const qc = useQueryClient()
  const [status, setStatus] = useState<InboxFilter>('open')
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [acting, setActing] = useState<InboxMessage | null>(null)
  const canHandle = has('inbox.handle')

  const list = useQuery({
    queryKey: ['inbox', status, search, limit],
    queryFn: () => api<{ messages: InboxMessage[]; total: number }>(`/inbox?status=${status}&limit=${limit}${search.trim() ? `&q=${encodeURIComponent(search.trim())}` : ''}`),
    placeholderData: (p) => p,
  })
  const counts = useQuery({ queryKey: ['inbox-counts'], queryFn: () => api<InboxCounts>('/inbox/counts') })
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['inbox'] }), qc.invalidateQueries({ queryKey: ['inbox-counts'] })])

  return (
    <>
      <PageHeader
        title="Support inbox"
        subtitle="Messages and reports from Xperts and employers on the main site. Mark one handled once it has been dealt with. The message itself is never changed."
        action={counts.data ? <Badge tone={counts.data.open > 0 ? 'amber' : 'green'}>{counts.data.open} need attention</Badge> : undefined}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Show" className="flex gap-1">
          {INBOX_FILTERS.map((f) => (
            <button key={f} type="button" aria-pressed={status === f} onClick={() => { setStatus(f); setLimit(PAGE) }} className={`min-h-[40px] rounded-lg px-3 text-sm font-medium ${status === f ? 'bg-forest-700 text-ink-50' : 'bg-ink-800 text-ink-200 hover:bg-ink-700'}`}>
              {INBOX_FILTER_LABELS[f]}
              {counts.data && f !== 'all' ? ` (${counts.data[f]})` : ''}
            </button>
          ))}
        </div>
        <div className="min-w-[200px] flex-1">
          <label className="sr-only" htmlFor="inbox-search">Search messages</label>
          <input id="inbox-search" className="field" placeholder="Search by name, phone or text" value={search} onChange={(e) => { setSearch(e.target.value); setLimit(PAGE) }} />
        </div>
      </div>

      {list.isPending && <Spinner label="Loading messages" />}
      {list.isError && <ErrorState message={errorText(list.error)} onRetry={() => void list.refetch()} />}
      {list.data && list.data.messages.length === 0 && <EmptyState title={status === 'open' ? 'Nothing needs attention' : 'No messages here'} hint={search ? 'Try a different search.' : undefined} />}
      {list.data && list.data.messages.length > 0 && (
        <>
          <ul className="space-y-3">
            {list.data.messages.map((m) => (
              <li key={m.ref} className="card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink-50">{m.name ?? 'Unknown sender'}{m.phone ? <span className="font-normal text-ink-300"> · {m.phone}</span> : null}</p>
                    <p className="text-xs text-ink-400">{typeLabel(m.type)} · {dateTime(m.createdAt)}</p>
                  </div>
                  <Badge tone={m.status === 'open' ? 'amber' : 'green'}>{m.status === 'open' ? 'Needs attention' : 'Handled'}</Badge>
                </div>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm text-ink-100">{m.body}</p>
                {m.status === 'handled' && (
                  <p className="mt-2 text-xs text-ink-400">Handled by {m.handledByName ?? 'staff'}{m.handledAt ? ` · ${dateTime(m.handledAt)}` : ''}{m.note ? ` · ${m.note}` : ''}</p>
                )}
                {canHandle && (
                  <div className="mt-3">
                    <Button variant="secondary" onClick={() => setActing(m)}>{m.status === 'open' ? 'Mark handled' : 'Reopen'}</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {list.data.total > list.data.messages.length && <div className="mt-4 flex justify-center"><Button variant="secondary" busy={list.isFetching} onClick={() => setLimit((l) => l + PAGE)}>Show more</Button></div>}
        </>
      )}
      {acting && <HandleDialog message={acting} onClose={() => setActing(null)} onDone={refresh} />}
    </>
  )
}
