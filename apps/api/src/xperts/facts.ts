import {
  isActiveStatus,
  type ActiveStatus,
  type EvidenceRecord,
  type GuarantorFacts,
  type GuarantorRecord,
  type ReferenceRecord,
  type StatusHistoryRow,
} from '@beyondx/shared'

/** The active level an Xpert held before the Under Review or Suspended spell they are in now. Newest history first. */
export function previousActiveStatus(historyNewestFirst: readonly StatusHistoryRow[]): ActiveStatus | null {
  for (const h of historyNewestFirst) {
    if ((h.newStatus === 'under_review' || h.newStatus === 'suspended') && h.oldStatus && isActiveStatus(h.oldStatus)) {
      return h.oldStatus
    }
  }
  return null
}

export function guarantorFacts(g: GuarantorRecord | null): GuarantorFacts | null {
  if (!g) return null
  return {
    namedAt: g.namedAt,
    explainerSentAt: g.explainerMessageSentAt,
    callbackOutcome: g.callbackOutcome,
    retractedAt: g.retractedAt,
  }
}

/** People who did first pass work, so they cannot also remove the Xpert. */
export function firstPassReviewers(
  guarantor: GuarantorRecord | null,
  evidence: readonly EvidenceRecord[],
  references: readonly ReferenceRecord[],
): string[] {
  const ids = [guarantor?.assignedTo, ...evidence.map((e) => e.reviewedBy), ...references.map((r) => r.calledBy)]
  return [...new Set(ids.filter((i): i is string => !!i))]
}

/** A reference counts toward full activation only when it was confirmed and raised no warning. */
export function hasCountedReference(references: readonly ReferenceRecord[]): boolean {
  return references.some((r) => r.outcome === 'confirmed' && r.warnings.length === 0)
}

export function hasVerifiedCertification(evidence: readonly EvidenceRecord[]): boolean {
  return evidence.some((e) => e.evidenceType === 'certification' && e.reviewOutcome === 'pass')
}
