import {
  PAYMENT_STATUS_LABELS,
  QUOTE_STATUS_LABELS,
  REQUEST_STATUS_LABELS,
  type PaymentStatus,
  type QuoteStatus,
  type RequestStatus,
} from '@beyondx/shared'
import { Badge } from './ui'

const REQ_TONE: Record<RequestStatus, 'neutral' | 'green' | 'amber' | 'red'> = { new: 'amber', quoted: 'neutral', accepted: 'green', declined: 'red', expired: 'red', cancelled: 'red' }
export const RequestStatusBadge = ({ status }: { status: RequestStatus }) => <Badge tone={REQ_TONE[status]}>{REQUEST_STATUS_LABELS[status]}</Badge>

const Q_TONE: Record<QuoteStatus, 'neutral' | 'green' | 'amber' | 'red'> = { draft: 'amber', sent: 'neutral', accepted: 'green', declined: 'red', expired: 'red', withdrawn: 'neutral' }
export const QuoteStatusBadge = ({ status }: { status: QuoteStatus }) => <Badge tone={Q_TONE[status]}>{QUOTE_STATUS_LABELS[status]}</Badge>

const P_TONE: Record<PaymentStatus, 'neutral' | 'green' | 'amber' | 'red'> = { pending: 'amber', received: 'green', released: 'green', refunded: 'neutral' }
export const PaymentStatusBadge = ({ status }: { status: PaymentStatus }) => <Badge tone={P_TONE[status]}>{PAYMENT_STATUS_LABELS[status]}</Badge>
