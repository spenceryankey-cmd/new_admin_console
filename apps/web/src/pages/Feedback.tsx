import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import type { FeedbackRecord } from '@beyondx/shared'
import { Badge, Button, EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui'
import { api, errorText } from '../lib/api'
import { dateTime } from '../lib/format'

const PAGE = 30
const yn = (v: boolean | null) => (v === null ? 'Not said' : v ? 'Yes' : 'No')

export function Feedback() {
  const [limit, setLimit] = useState(PAGE)
  const list = useQuery({ queryKey: ['feedback', limit], queryFn: () => api<{ feedback: FeedbackRecord[]; total: number }>(`/feedback?limit=${limit}`), placeholderData: (p) => p })
  return (
    <>
      <PageHeader title="Feedback" subtitle="What employers and Xperts said about finished jobs. Employer ratings of 4 or more, on time and with no upheld flag, count as a clean job." />
      {list.isPending && <Spinner label="Loading feedback" />}
      {list.isError && <ErrorState message={errorText(list.error)} onRetry={() => void list.refetch()} />}
      {list.data && list.data.feedback.length === 0 && <EmptyState title="No feedback yet" hint="Log feedback from a completed job." />}
      {list.data && list.data.feedback.length > 0 && (
        <>
          <ul className="space-y-3">
            {list.data.feedback.map((f) => (
              <li key={f.id} className="card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink-50">{f.xpertName ?? 'Xpert'} · <Link className="hover:underline" to={`/jobs/${f.jobId}`}>{f.jobLabel ?? 'Job'}</Link></p>
                    <p className="text-sm text-ink-300">{f.side === 'employer' ? 'From the employer' : 'From the Xpert'} · {f.rating} of 5 · On time: {yn(f.onTime)} · Would use again: {yn(f.wouldRepeat)}</p>
                    {f.comment && <p className="mt-1 text-sm text-ink-100">{f.comment}</p>}
                    <p className="mt-0.5 text-xs text-ink-400">{dateTime(f.createdAt)}{f.loggedByName ? ` · logged by ${f.loggedByName}` : ''}</p>
                  </div>
                  <Badge tone={f.rating >= 4 ? 'green' : f.rating <= 2 ? 'red' : 'neutral'}>{f.rating} of 5</Badge>
                </div>
              </li>
            ))}
          </ul>
          {list.data.total > list.data.feedback.length && <div className="mt-4 flex justify-center"><Button variant="secondary" busy={list.isFetching} onClick={() => setLimit((l) => l + PAGE)}>Show more</Button></div>}
        </>
      )}
    </>
  )
}
