import { useInfiniteQuery } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import type { AuditEntry } from '@beyondx/shared'
import { Button, EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui'
import { api, errorText } from '../lib/api'
import { changedKeys, dateTime } from '../lib/format'

type Page = { entries: AuditEntry[]; nextBefore: number | null }

const FILTERS = [
  { value: '', label: 'Everything' },
  { value: 'staff_profile', label: 'Staff accounts' },
  { value: 'role_permission', label: 'Role permissions' },
]

export function AuditLog() {
  const [entityType, setEntityType] = useState('')
  const [open, setOpen] = useState<number | null>(null)

  const q = useInfiniteQuery({
    queryKey: ['audit', entityType],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ limit: '50' })
      if (pageParam) p.set('before', String(pageParam))
      if (entityType) p.set('entityType', entityType)
      return api<Page>(`/audit?${p.toString()}`)
    },
    getNextPageParam: (last) => last.nextBefore ?? undefined,
  })

  const entries = q.data?.pages.flatMap((p) => p.entries) ?? []

  return (
    <>
      <PageHeader title="Audit log" subtitle="Every action taken in the console, newest first. Entries cannot be edited or deleted." />
      <div className="mb-4 max-w-xs">
        <label className="label" htmlFor="af">Show</label>
        <select id="af" className="field" value={entityType} onChange={(e) => setEntityType(e.target.value)}>
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
      </div>

      {q.isPending && <Spinner label="Loading the audit log" />}
      {q.isError && <ErrorState message={errorText(q.error)} onRetry={() => void q.refetch()} />}
      {q.data && entries.length === 0 && <EmptyState title="Nothing recorded yet" hint="Actions appear here as soon as they happen." />}

      {entries.length > 0 && (
        <ul className="space-y-2">
          {entries.map((e) => {
            const keys = changedKeys(e.before, e.after)
            const isOpen = open === e.id
            return (
              <li key={e.id} className="card">
                <button
                  className="flex w-full items-start gap-3 p-4 text-left"
                  onClick={() => setOpen(isOpen ? null : e.id)}
                  aria-expanded={isOpen}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-xs text-forest-300">{e.action}</p>
                    <p className="mt-1 truncate text-sm text-ink-50">{e.actorEmail ?? 'System'}</p>
                    {e.reason && <p className="mt-1 text-sm text-ink-300">Reason: {e.reason}</p>}
                    <p className="mt-1 text-xs text-ink-400">{dateTime(e.occurredAt)}</p>
                  </div>
                  <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-ink-400 transition ${isOpen ? 'rotate-180' : ''}`} aria-hidden />
                </button>
                {isOpen && (
                  <div className="border-t border-ink-700 p-4 text-sm">
                    <p className="text-xs text-ink-300">Record: <span className="font-mono">{e.entityType} {e.entityId}</span></p>
                    {keys.length === 0 ? (
                      <p className="mt-2 text-ink-300">No field changes were recorded for this action.</p>
                    ) : (
                      <table className="mt-3 w-full text-left text-xs">
                        <thead className="text-ink-300">
                          <tr><th className="pb-1 pr-3 font-semibold">Field</th><th className="pb-1 pr-3 font-semibold">Before</th><th className="pb-1 font-semibold">After</th></tr>
                        </thead>
                        <tbody className="font-mono text-ink-100">
                          {keys.map((k) => (
                            <tr key={k} className="align-top">
                              <td className="py-1 pr-3 text-ink-300">{k}</td>
                              <td className="break-all py-1 pr-3">{show((e.before as Record<string, unknown> | null)?.[k])}</td>
                              <td className="break-all py-1">{show((e.after as Record<string, unknown> | null)?.[k])}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {q.hasNextPage && (
        <div className="mt-4 text-center">
          <Button variant="secondary" onClick={() => void q.fetchNextPage()} busy={q.isFetchingNextPage}>Load older entries</Button>
        </div>
      )}
    </>
  )
}

const show = (v: unknown) => (v === undefined || v === null ? 'none' : typeof v === 'string' ? v : JSON.stringify(v))
