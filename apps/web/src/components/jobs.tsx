import { CHANGE_ORDER_LABELS, JOB_STATUS_LABELS, type ChangeOrderStatus, type JobStatus } from '@beyondx/shared'
import { Badge } from './ui'

const TONE: Record<JobStatus, 'neutral' | 'green' | 'amber' | 'red'> = { awaiting_dispatch: 'amber', dispatched: 'neutral', in_progress: 'neutral', completed: 'green', cancelled: 'red' }
export const JobStatusBadge = ({ status }: { status: JobStatus }) => <Badge tone={TONE[status]}>{JOB_STATUS_LABELS[status]}</Badge>

const CTONE: Record<ChangeOrderStatus, 'neutral' | 'green' | 'amber' | 'red'> = { logged: 'amber', confirmed: 'green', rejected: 'red', cancelled: 'neutral' }
export const ChangeOrderBadge = ({ status }: { status: ChangeOrderStatus }) => <Badge tone={CTONE[status]}>{CHANGE_ORDER_LABELS[status]}</Badge>
