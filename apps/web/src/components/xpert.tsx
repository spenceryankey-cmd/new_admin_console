import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { STATUS_LABELS, VERIFICATION_SOURCE_LABELS, waitingFor, type VerificationSource, type XpertStatus } from '@beyondx/shared'
import { Badge, Button } from './ui'
import { api } from '../lib/api'

const TONE: Record<XpertStatus, 'neutral' | 'green' | 'amber' | 'red'> = {
  applied: 'neutral',
  guarantor_pending: 'amber',
  guarantor_confirmed: 'amber',
  skill_verification: 'amber',
  provisional_active: 'green',
  full_active: 'green',
  under_review: 'amber',
  suspended: 'red',
  removed: 'red',
  inactive: 'neutral',
  blocked_closed: 'red',
}

export function StatusBadge({ status }: { status: XpertStatus }) {
  return <Badge tone={TONE[status]}>{STATUS_LABELS[status]}</Badge>
}

/** Shown wherever verification appears, so nobody mistakes a coordinator's word for BeyondX's own check. */
export function SourceBadge({ source }: { source: VerificationSource | null }) {
  if (!source) return null
  return <Badge tone={source === 'direct_beyondx' ? 'green' : 'neutral'}>{VERIFICATION_SOURCE_LABELS[source]}</Badge>
}

export function Waiting({ since }: { since: string }) {
  return <span className="text-xs text-ink-300">Waiting {waitingFor(since, new Date())}</span>
}

export function XpertLink({ id, name }: { id: string; name: string }) {
  return (
    <Link to={`/xperts/${encodeURIComponent(id)}`} className="text-sm font-semibold text-ink-50 underline-offset-2 hover:text-forest-300 hover:underline">
      {name}
    </Link>
  )
}

/** Refresh everything that depends on screening state after a change. */
export function useRefreshScreening() {
  const qc = useQueryClient()
  return () =>
    Promise.all(['xperts', 'xpert', 'queue', 'counts'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
}

/** Take or hand back a queue item so two people do not work the same one. */
export function ClaimControl({
  kind,
  id,
  assignedTo,
  assignedToName,
  meId,
}: {
  kind: 'guarantors' | 'evidence' | 'references'
  id: string
  assignedTo: string | null
  assignedToName: string | null
  meId: string
}) {
  const refresh = useRefreshScreening()
  const claim = useMutation({
    mutationFn: (release: boolean) => api(`/queues/${kind}/${id}/claim`, { method: 'POST', body: { release } }),
    onSuccess: refresh,
  })
  const mine = assignedTo === meId
  return (
    <div className="flex flex-wrap items-center gap-2">
      {assignedTo ? (
        <Badge tone={mine ? 'green' : 'amber'}>{mine ? 'You are on this' : `${assignedToName ?? 'Someone'} is on this`}</Badge>
      ) : (
        <Badge>Nobody yet</Badge>
      )}
      {!assignedTo && (
        <Button variant="secondary" className="min-h-[32px] px-3 py-1" busy={claim.isPending} onClick={() => claim.mutate(false)}>
          Take this
        </Button>
      )}
      {assignedTo && mine && (
        <Button variant="ghost" className="min-h-[32px] px-3 py-1" busy={claim.isPending} onClick={() => claim.mutate(true)}>
          Hand back
        </Button>
      )}
      {claim.isError && (
        <span role="alert" className="text-xs text-danger-400">
          {claim.error instanceof Error ? claim.error.message : 'Could not update'}
        </span>
      )}
    </div>
  )
}
