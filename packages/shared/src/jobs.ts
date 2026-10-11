// Jobs, dispatch matching, change orders and recurring services. One place for the rules.

export const JOB_STATUSES = ['awaiting_dispatch', 'dispatched', 'in_progress', 'completed', 'cancelled'] as const
export type JobStatus = (typeof JOB_STATUSES)[number]
export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  awaiting_dispatch: 'Needs an Xpert',
  dispatched: 'Dispatched',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
}
export const JOB_OPEN: readonly JobStatus[] = ['awaiting_dispatch', 'dispatched', 'in_progress']

type JobMove = { from: JobStatus; to: JobStatus; reasonRequired: boolean; note: string }
export const JOB_MOVES: readonly JobMove[] = [
  { from: 'awaiting_dispatch', to: 'dispatched', reasonRequired: false, note: 'An Xpert is chosen.' },
  { from: 'dispatched', to: 'in_progress', reasonRequired: false, note: 'The Xpert starts the work.' },
  { from: 'in_progress', to: 'completed', reasonRequired: false, note: 'The employer and the Xpert both confirm.' },
  { from: 'awaiting_dispatch', to: 'cancelled', reasonRequired: true, note: 'The job is cancelled.' },
  { from: 'dispatched', to: 'cancelled', reasonRequired: true, note: 'The job is cancelled.' },
  { from: 'in_progress', to: 'cancelled', reasonRequired: true, note: 'The job is cancelled.' },
]
export const jobMove = (from: JobStatus, to: JobStatus) => JOB_MOVES.find((m) => m.from === from && m.to === to) ?? null
/** An Xpert can be replaced only while one is on the job. */
export const canReplace = (s: JobStatus) => s === 'dispatched' || s === 'in_progress'

export const CHANGE_ORDER_STATUSES = ['logged', 'confirmed', 'rejected', 'cancelled'] as const
export type ChangeOrderStatus = (typeof CHANGE_ORDER_STATUSES)[number]
export const CHANGE_ORDER_LABELS: Record<ChangeOrderStatus, string> = { logged: 'Waiting for confirmation', confirmed: 'Confirmed by both', rejected: 'Rejected', cancelled: 'Cancelled' }

export const FREQUENCIES = ['weekly', 'fortnightly', 'monthly'] as const
export type Frequency = (typeof FREQUENCIES)[number]
export const FREQUENCY_LABELS: Record<Frequency, string> = { weekly: 'Every week', fortnightly: 'Every two weeks', monthly: 'Every month' }

export type MatchInput = {
  job: { category: string; location: string; amountGhs: number }
  xpert: { id: string; fullName: string; status: string; accountActive: boolean; homeArea: string | null; skills: string[] }
  band: { minGhs: number; maxGhs: number } | null
  activeJobs: number
}
export type Match = {
  xpertId: string
  fullName: string
  status: string
  homeArea: string | null
  skills: string[]
  activeJobs: number
  band: { minGhs: number; maxGhs: number } | null
  price: 'within' | 'above' | 'below' | 'no_band'
  sameArea: boolean
  score: number
  notes: string[]
}

const norm = (s: string) => s.trim().toLowerCase()

/** Null when the Xpert cannot take this job at all. Otherwise a score, higher is better. */
export function matchXpert(i: MatchInput): Match | null {
  if (!i.xpert.accountActive) return null
  if (i.xpert.status !== 'provisional_active' && i.xpert.status !== 'full_active') return null
  const cat = norm(i.job.category)
  if (!i.xpert.skills.some((s) => norm(s) === cat || norm(s).includes(cat) || cat.includes(norm(s)))) return null
  const notes: string[] = []
  let score = 50
  let price: Match['price'] = 'no_band'
  if (i.band) {
    if (i.job.amountGhs < i.band.minGhs) { price = 'below'; score -= 15; notes.push('The job pays below their band.') }
    else if (i.job.amountGhs > i.band.maxGhs) { price = 'above'; score += 5; notes.push('The job pays above their band.') }
    else { price = 'within'; score += 15 }
  } else notes.push('No price band set for this category.')
  const sameArea = !!i.xpert.homeArea && norm(i.job.location).includes(norm(i.xpert.homeArea))
  if (sameArea) score += 15
  if (i.xpert.status === 'full_active') score += 10
  else notes.push('Provisionally active.')
  score -= Math.min(i.activeJobs, 5) * 8
  if (i.activeJobs > 0) notes.push(`${i.activeJobs} job${i.activeJobs === 1 ? '' : 's'} already on.`)
  return { xpertId: i.xpert.id, fullName: i.xpert.fullName, status: i.xpert.status, homeArea: i.xpert.homeArea, skills: i.xpert.skills, activeJobs: i.activeJobs, band: i.band, price, sameArea, score, notes }
}

export type JobWatch = { kind: 'start_overdue' | 'confirmation_overdue'; label: string }
export type MonitorConfig = { startOverdueHours: number; confirmationOverdueHours: number }
export const DEFAULT_MONITOR_CONFIG: MonitorConfig = { startOverdueHours: 24, confirmationOverdueHours: 48 }

/** What needs a person's attention on a live job. */
export function watchJob(j: { status: JobStatus; dispatchedAt: string | null; employerConfirmedAt: string | null; xpertConfirmedAt: string | null }, now: Date, c: MonitorConfig): JobWatch | null {
  const hours = (iso: string) => (now.getTime() - new Date(iso).getTime()) / 3_600_000
  if (j.status === 'dispatched' && j.dispatchedAt && hours(j.dispatchedAt) >= c.startOverdueHours) return { kind: 'start_overdue', label: `Not started ${Math.floor(hours(j.dispatchedAt))} hours after dispatch` }
  if (j.status === 'in_progress') {
    const first = [j.employerConfirmedAt, j.xpertConfirmedAt].filter((x): x is string => !!x)
    if (first.length === 1 && hours(first[0]!) >= c.confirmationOverdueHours) return { kind: 'confirmation_overdue', label: `Waiting ${Math.floor(hours(first[0]!))} hours for the ${j.employerConfirmedAt ? 'Xpert' : 'employer'} to confirm` }
  }
  return null
}
