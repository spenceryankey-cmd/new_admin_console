import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FLAG_CATEGORY_LABELS, FLAG_STATUSES, FLAG_STATUS_LABELS, type FlagRecord, type FlagStatus } from '@beyondx/shared'
import { EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui'
import { FlagStatusBadge } from '../components/trust'
import { api, errorText } from '../lib/api'
import { dateTime } from '../lib/format'

export function Flags() {
  const [status, setStatus] = useState<FlagStatus | ''>('open')
  const list = useQuery({ queryKey: ['flags', status], queryFn: () => api<{ flags: FlagRecord[]; total: number }>(`/flags?limit=100${status ? `&status=${status}` : ''}`) })
  return (
    <>
      <PageHeader title="Flags" subtitle="Concerns raised about an Xpert. Decision makers investigate and decide. The Xpert or the employer can add a counter flag before the decision." />
      <div className="mb-4"><select className="field sm:w-64" aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value as FlagStatus | '')}><option value="">All</option>{FLAG_STATUSES.filter((s) => s !== 'reviewed').map((s) => <option key={s} value={s}>{FLAG_STATUS_LABELS[s]}</option>)}</select></div>
      {list.isPending && <Spinner label="Loading flags" />}
      {list.isError && <ErrorState message={errorText(list.error)} onRetry={() => void list.refetch()} />}
      {list.data && list.data.flags.length === 0 && <EmptyState title="No flags here" hint="Flags are raised from an Xpert's record." />}
      {list.data && list.data.flags.length > 0 && (
        <ul className="space-y-3">
          {list.data.flags.map((f) => (
            <li key={f.id}>
              <Link to={`/flags/${f.id}`} className="card flex flex-wrap items-center gap-x-6 gap-y-2 p-4 transition hover:border-forest-600">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="text-sm font-semibold text-ink-50">{f.xpertName ?? f.xpertId} · {FLAG_CATEGORY_LABELS[f.category]}</p>
                  <p className="truncate text-sm text-ink-300">{f.detail}</p>
                  <p className="mt-0.5 text-xs text-ink-400">Raised {dateTime(f.createdAt)}</p>
                </div>
                <FlagStatusBadge status={f.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
