// Flags, feedback, the reliability record and coordinators. One place for the rules.

export const FLAG_CATEGORIES = ['no_show', 'conduct', 'quality', 'safety', 'pricing', 'other'] as const
export type FlagCategory = (typeof FLAG_CATEGORIES)[number]
export const FLAG_CATEGORY_LABELS: Record<FlagCategory, string> = { no_show: 'No show', conduct: 'Conduct', quality: 'Quality of work', safety: 'Safety', pricing: 'Pricing', other: 'Other' }

/** The fixed reasons that can be attached to feedback. The same list is a check constraint in migration 0010. */
export const FEEDBACK_REASONS = [
  'quality_work',
  'communicated_well',
  'left_site_clean',
  'followed_instructions',
  'poor_quality',
  'poor_communication',
  'left_site_dirty',
  'ignored_instructions',
  'safety_concern',
] as const
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number]
export const FEEDBACK_REASON_LABELS: Record<FeedbackReason, string> = {
  quality_work: 'Good quality of work',
  communicated_well: 'Communicated well',
  left_site_clean: 'Left the site clean',
  followed_instructions: 'Followed instructions',
  poor_quality: 'Poor quality of work',
  poor_communication: 'Poor communication',
  left_site_dirty: 'Left the site untidy',
  ignored_instructions: 'Did not follow instructions',
  safety_concern: 'A safety concern',
}
export const FEEDBACK_REASON_GROUPS = {
  good: ['quality_work', 'communicated_well', 'left_site_clean', 'followed_instructions'],
  concern: ['poor_quality', 'poor_communication', 'left_site_dirty', 'ignored_instructions', 'safety_concern'],
} as const satisfies Record<string, readonly FeedbackReason[]>
/** A rating of 2 or lower must say why. */
export const LOW_RATING_MAX = 2

export const FLAG_STATUSES = ['open', 'investigating', 'upheld', 'dismissed', 'reviewed'] as const
export type FlagStatus = (typeof FLAG_STATUSES)[number]
export const FLAG_STATUS_LABELS: Record<FlagStatus, string> = { open: 'Open', investigating: 'Being investigated', upheld: 'Upheld', dismissed: 'Dismissed', reviewed: 'Reviewed with the flag' }
export const FLAG_RAISERS = ['employer', 'xpert', 'staff', 'system'] as const
export type FlagRaiser = (typeof FLAG_RAISERS)[number]
export const FLAG_RAISER_LABELS: Record<FlagRaiser, string> = { employer: 'The employer', xpert: 'The Xpert', staff: 'Staff', system: 'The system' }
export const FLAG_OPEN: readonly FlagStatus[] = ['open', 'investigating']

/**
 * What the status rules accept when a decision maker sends an Xpert to Under Review after upholding a flag.
 * Safety goes under the safety trigger, a no show under no shows, anything else under named incident.
 */
export function reviewTriggerFor(category: FlagCategory): 'safety_concern' | 'no_shows' | 'flag_named_incident' {
  return category === 'safety' ? 'safety_concern' : category === 'no_show' ? 'no_shows' : 'flag_named_incident'
}

/** A job counts as clean: completed, employer rated 4 or more, not marked late, and no upheld flag on that job. */
export function isCleanJob(j: { completed: boolean; employerRating: number | null; onTime: boolean | null; upheldFlags: number }): boolean {
  return j.completed && j.employerRating !== null && j.employerRating >= 4 && j.onTime !== false && j.upheldFlags === 0
}

export const CLEAN_RATING_MIN = 4

export type ReliabilityRecord = {
  xpertId: string
  jobsCompleted: number
  cleanJobs: number
  avgRating: number | null
  onTimeRate: number | null
  timesReplaced: number
  jobsWithdrawn: number
  flagsUpheld: number
  flagsOpen: number
}
export const EMPTY_RELIABILITY = (xpertId: string): ReliabilityRecord => ({ xpertId, jobsCompleted: 0, cleanJobs: 0, avgRating: null, onTimeRate: null, timesReplaced: 0, jobsWithdrawn: 0, flagsUpheld: 0, flagsOpen: 0 })
