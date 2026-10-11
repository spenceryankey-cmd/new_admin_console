import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { useState } from 'react'
import { XPERT_STATUSES, STATUS_LABELS, type XpertStatus, type XpertSummary } from '@beyondx/shared'
import { EmptyState, ErrorState, PageHeader, Spinner, Button } from '../components/ui'
import { SourceBadge, StatusBadge, XpertLink } from '../components/xpert'
import { api, errorText } from '../lib/api'
import { dateTime } from '../lib/format'

const PAGE = 30

export function Xperts() {
  const [status, setStatus] = useState<XpertStatus | ''>('')
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(PAGE)

  const list = useQuery({
    queryKey: ['xperts', status, q, limit],
    queryFn: () => api<{ xperts: XpertSummary[]; total: number }>(`/xperts?limit=${limit}${status ? `&status=${status}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`),
    placeholderData: (prev) => prev,
  })

  return (
    <>
      <PageHeader title="Xpert pipeline" subtitle="Every Xpert by status. Open one to see their full record, screening and history." />
      <form
        className="mb-4 flex flex-col gap-3 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault()
          setQ(text.trim())
          setLimit(PAGE)
        }}
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-ink-400" aria-hidden />
          <input className="field pl-9" placeholder="Search by name or phone" aria-label="Search Xperts" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <select
          className="field sm:w-60"
          aria-label="Filter by status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as XpertStatus | '')
            setLimit(PAGE)
          }}
        >
          <option value="">All statuses</option>
          {XPERT_STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>
        <Button type="submit" variant="secondary">Search</Button>
      </form>

      {list.isPending && <Spinner label="Loading Xperts" />}
      {list.isError && <ErrorState message={errorText(list.error)} onRetry={() => void list.refetch()} />}
      {list.data && list.data.xperts.length === 0 && <EmptyState title="No Xperts match" hint={status || q ? 'Try a different status or search.' : 'Applications will appear here as they come in.'} />}
      {list.data && list.data.xperts.length > 0 && (
        <>
          <p className="mb-3 text-xs text-ink-300">Showing {list.data.xperts.length} of {list.data.total}</p>
          <ul className="space-y-3">
            {list.data.xperts.map((x) => (
              <li key={x.id} className="card flex flex-wrap items-center gap-x-6 gap-y-2 p-4">
                <div className="min-w-0 flex-1 basis-56">
                  <XpertLink id={x.id} name={x.fullName} />
                  <p className="truncate text-sm text-ink-300">{[x.phone, x.homeArea].filter(Boolean).join(' · ') || 'No contact details'}</p>
                  {x.createdAt && <p className="mt-0.5 text-xs text-ink-400">Applied {dateTime(x.createdAt)}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={x.status} />
                  <SourceBadge source={x.verificationSource} />
                </div>
              </li>
            ))}
          </ul>
          {list.data.total > list.data.xperts.length && (
            <div className="mt-4 flex justify-center">
              <Button variant="secondary" busy={list.isFetching} onClick={() => setLimit((l) => l + PAGE)}>Show more</Button>
            </div>
          )}
        </>
      )}
    </>
  )
}
