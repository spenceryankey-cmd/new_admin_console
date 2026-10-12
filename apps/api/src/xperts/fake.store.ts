import { randomUUID } from 'node:crypto'
import type { EvidenceRecord, GuarantorRecord, ReferenceRecord, StatusHistoryRow, XpertStatus, XpertSummary } from '@beyondx/shared'
import { StoreError, type ApplyTransition, type XpertStore } from './xpert.store'

/** In memory stand in for the database, used by the tests. It mirrors the transition function's rules. */
export class FakeStore implements XpertStore {
  xperts = new Map<string, XpertSummary>()
  hist: (StatusHistoryRow & { xpertId: string })[] = []
  guarantors: GuarantorRecord[] = []
  evidence: EvidenceRecord[] = []
  references: (ReferenceRecord & { callLog: unknown[] })[] = []
  config: { key: string; value: unknown; pending: boolean; note: string | null; updated_at: string }[] = []
  legacy: Record<string, { name: string; contact: string; relationship: string | null; namedAt: string | null }> = {}
  private seq = 1

  addXpert(id: string, status: XpertStatus, extra: Partial<XpertSummary> = {}) {
    this.xperts.set(id, { id, fullName: `Xpert ${id}`, phone: '0240000000', homeArea: null, skills: [], status, accountActive: false, verificationSource: null, activatedAt: null, createdAt: '2026-01-01T00:00:00Z', statusSince: null, ...extra })
  }

  async listXperts(f?: { status?: XpertStatus; q?: string; limit?: number; offset?: number }) {
    let rows = [...this.xperts.values()]
    if (f?.status) rows = rows.filter((x) => x.status === f.status)
    if (f?.q) rows = rows.filter((x) => `${x.fullName} ${x.phone}`.toLowerCase().includes(f.q!.toLowerCase()))
    return { rows: rows.slice(f?.offset ?? 0, (f?.offset ?? 0) + (f?.limit ?? 30)), total: rows.length }
  }
  async getXpert(id: string) { return this.xperts.get(id) ?? null }
  async xpertsByIds(ids: string[]) { return new Map(ids.flatMap((i) => (this.xperts.has(i) ? [[i, this.xperts.get(i)!] as const] : []))) }
  async xpertsByStatus(s: XpertStatus) { return [...this.xperts.values()].filter((x) => x.status === s) }
  async legacyGuarantor(id: string) { return this.legacy[id] ?? null }
  async repairAuditMirror() { return 0 }
  async existingXpertIds(ids: string[]) { return new Set(ids.filter((i) => this.xperts.has(i))) }

  failNextTransition = false
  async applyTransition(t: ApplyTransition) {
    if (this.failNextTransition) { this.failNextTransition = false; throw new StoreError('failed', 'The hetzner database did not answer') }
    const x = this.xperts.get(t.xpertId)
    if (!x) throw new StoreError('not_found', 'nf')
    if (x.status !== t.expectedFrom) throw new StoreError('conflict', 'Status changed')
    x.status = t.to
    if (t.setActive !== null) x.accountActive = t.setActive
    if (t.setActive) x.activatedAt = new Date().toISOString()
    if (t.verificationSource) x.verificationSource = t.verificationSource
    this.hist.unshift({ xpertId: t.xpertId, id: this.seq++, oldStatus: t.expectedFrom, newStatus: t.to, changedBy: t.actorId, changedByName: null, automatic: t.automatic, trigger: t.trigger, reason: t.reason, changedAt: new Date().toISOString() })
  }
  async history(id: string) { return this.hist.filter((h) => h.xpertId === id) }
  async lastEntered() { return new Map<string, string>() }

  async liveGuarantor(xpertId: string) { return this.guarantors.find((g) => g.xpertId === xpertId && !g.retractedAt) ?? null }
  async guarantorById(id: string) { return this.guarantors.find((g) => g.id === id) ?? null }
  async guarantorsFor(ids: string[]) { return new Map(this.guarantors.filter((g) => ids.includes(g.xpertId) && !g.retractedAt).map((g) => [g.xpertId, g])) }
  async createGuarantor(g: any) {
    const rec: GuarantorRecord = { id: randomUUID(), xpertId: g.xpertId, name: g.name, contact: g.contact, relationship: g.relationship, namedAt: g.namedAt ?? new Date().toISOString(), explainerMessageSentAt: null, callbackConfirmedAt: null, callbackOutcome: null, retractedAt: null, assignedTo: null, assignedToName: null }
    this.guarantors.push(rec)
    return rec
  }
  async patchGuarantor(id: string, patch: Record<string, unknown>) {
    const g = this.guarantors.find((x) => x.id === id)!
    const map: Record<string, keyof GuarantorRecord> = { explainer_sent_at: 'explainerMessageSentAt', callback_outcome: 'callbackOutcome', callback_confirmed_at: 'callbackConfirmedAt', retracted_at: 'retractedAt', assigned_to: 'assignedTo' }
    for (const [k, v] of Object.entries(patch)) if (map[k]) (g as any)[map[k]!] = v
    return g
  }

  async evidenceFor(xpertId: string) { return this.evidence.filter((e) => e.xpertId === xpertId) }
  async evidenceById(id: string) { return this.evidence.find((e) => e.id === id) ?? null }
  async pendingEvidence() { return this.evidence.filter((e) => e.reviewOutcome === 'pending') }
  async createEvidence(e: any) {
    const rec: EvidenceRecord = { id: randomUUID(), xpertId: e.xpertId, taskType: e.taskType, evidenceType: e.evidenceType, link: e.link, filePath: e.filePath, reviewOutcome: 'pending', reviewedBy: null, reviewedByName: null, reviewedAt: null, autoFailHits: [], assignedTo: null, assignedToName: null, createdAt: new Date().toISOString() }
    this.evidence.push(rec)
    return rec
  }
  async patchEvidence(id: string, patch: Record<string, unknown>) {
    const e = this.evidence.find((x) => x.id === id)!
    if (patch.review_outcome) e.reviewOutcome = patch.review_outcome as any
    if (patch.reviewed_by) e.reviewedBy = patch.reviewed_by as string
    if (patch.auto_fail_hits) e.autoFailHits = patch.auto_fail_hits as string[]
    if ('assigned_to' in patch) e.assignedTo = patch.assigned_to as string | null
    return e
  }

  async referencesFor(xpertId: string) { return this.references.filter((r) => r.xpertId === xpertId) }
  async referenceById(id: string) { return this.references.find((r) => r.id === id) ?? null }
  async pendingReferences() { return this.references.filter((r) => r.outcome === 'pending') }
  async createReference(r: any) {
    const rec = { id: randomUUID(), xpertId: r.xpertId, name: r.name, contact: r.contact, relationship: r.relationship, outcome: 'pending' as const, attemptsMade: 0, calledBy: null, calledByName: null, calledAt: null, warnings: r.warnings, assignedTo: null, assignedToName: null, createdAt: new Date().toISOString(), callLog: [] }
    this.references.push(rec)
    return rec
  }
  async patchReference(id: string, patch: Record<string, unknown>) {
    const r = this.references.find((x) => x.id === id)!
    if (patch.outcome) r.outcome = patch.outcome as any
    if (patch.attempts_made !== undefined) r.attemptsMade = patch.attempts_made as number
    if (patch.call_log) r.callLog = patch.call_log as unknown[]
    if (patch.called_by) r.calledBy = patch.called_by as string
    return r
  }

  clean = new Map<string, number>()
  async cleanCompletedJobs(xpertId: string) { return this.clean.get(xpertId) ?? 0 }

  async counts() {
    const n = (s: XpertStatus) => [...this.xperts.values()].filter((x) => x.status === s).length
    return { guarantors: n('guarantor_pending'), evidence: this.evidence.filter((e) => e.reviewOutcome === 'pending').length, references: this.references.filter((r) => r.outcome === 'pending').length, approvals: n('skill_verification') }
  }
  async configRows() { return this.config }
  async setConfig(key: string, value: unknown) {
    const row = this.config.find((c) => c.key === key)
    if (row) { row.value = value; row.pending = false } else this.config.push({ key, value, pending: false, note: null, updated_at: '' })
  }
  async staffNames() { return new Map<string, string>() }
  async signedUploadUrl(path: string) { return { path, token: 't', signedUrl: 'u' } }
  async signedDownloadUrl() { return 'https://signed' }
}
