import { Inject, Injectable } from '@nestjs/common'
import type {
  CallbackOutcome,
  EvidenceOutcome,
  EvidenceRecord,
  EvidenceType,
  GuarantorRecord,
  ReferenceOutcome,
  ReferenceRecord,
  StatusHistoryRow,
  Trigger,
  VerificationSource,
  XpertStatus,
  XpertSummary,
} from '@beyondx/shared'
import { SupabaseService } from '../supabase/supabase.service'

/** A domain failure the controllers turn into an HTTP error. */
export class StoreError extends Error {
  constructor(
    readonly kind: 'not_found' | 'conflict' | 'failed',
    message: string,
  ) {
    super(message)
  }
}

export type ListFilter = { status?: XpertStatus; q?: string; limit: number; offset: number }

export type ApplyTransition = {
  xpertId: string
  expectedFrom: XpertStatus
  to: XpertStatus
  trigger: Trigger | null
  reason: string | null
  actorId: string | null
  automatic: boolean
  setActive: boolean | null
  verificationSource?: VerificationSource | null
}

/** Everything the services need from the database. Tests replace it with a fake. */
export interface XpertStore {
  listXperts(f: ListFilter): Promise<{ rows: XpertSummary[]; total: number }>
  getXpert(id: string): Promise<XpertSummary | null>
  xpertsByIds(ids: string[]): Promise<Map<string, XpertSummary>>
  xpertsByStatus(status: XpertStatus, limit: number): Promise<XpertSummary[]>
  /** Guarantor details held on the Xpert record itself, when those columns are configured. */
  legacyGuarantor(xpertId: string): Promise<{ name: string; contact: string; relationship: string | null; namedAt: string | null } | null>

  applyTransition(t: ApplyTransition): Promise<void>
  /** Copies status change audit rows from the Xpert database that the console log missed. Returns how many were added. */
  repairAuditMirror(since: Date): Promise<number>
  /** Which of these Xpert ids exist in the Xpert database. */
  existingXpertIds(ids: string[]): Promise<Set<string>>
  history(xpertId: string): Promise<StatusHistoryRow[]>
  lastEntered(xpertIds: string[], status: XpertStatus): Promise<Map<string, string>>

  liveGuarantor(xpertId: string): Promise<GuarantorRecord | null>
  guarantorById(id: string): Promise<GuarantorRecord | null>
  guarantorsFor(xpertIds: string[]): Promise<Map<string, GuarantorRecord>>
  createGuarantor(g: { xpertId: string; name: string; contact: string; relationship: string | null; namedAt: string | null; actorId: string | null; reason: string }): Promise<GuarantorRecord>
  patchGuarantor(id: string, patch: Record<string, unknown>, actorId: string | null, reason: string): Promise<GuarantorRecord>

  evidenceFor(xpertId: string): Promise<EvidenceRecord[]>
  evidenceById(id: string): Promise<EvidenceRecord | null>
  pendingEvidence(limit: number): Promise<EvidenceRecord[]>
  createEvidence(e: { xpertId: string; taskType: string; evidenceType: EvidenceType; link: string | null; filePath: string | null; actorId: string }): Promise<EvidenceRecord>
  patchEvidence(id: string, patch: Record<string, unknown>, actorId: string, reason: string): Promise<EvidenceRecord>

  referencesFor(xpertId: string): Promise<ReferenceRecord[]>
  referenceById(id: string): Promise<(ReferenceRecord & { callLog: unknown[] }) | null>
  pendingReferences(limit: number): Promise<ReferenceRecord[]>
  createReference(r: { xpertId: string; name: string; contact: string; relationship: string; warnings: string[]; actorId: string }): Promise<ReferenceRecord>
  patchReference(id: string, patch: Record<string, unknown>, actorId: string, reason: string): Promise<ReferenceRecord>

  /** Completed jobs that count as clean (computed from the records). */
  cleanCompletedJobs(xpertId: string): Promise<number>
  counts(): Promise<{ guarantors: number; evidence: number; references: number; approvals: number }>
  configRows(): Promise<{ key: string; value: unknown; pending: boolean; note: string | null; updated_at: string }[]>
  setConfig(key: string, value: unknown, actorId: string, reason: string): Promise<void>
  staffNames(ids: (string | null)[]): Promise<Map<string, string>>

  signedUploadUrl(path: string): Promise<{ path: string; token: string; signedUrl: string }>
  signedDownloadUrl(path: string): Promise<string>
}

export const XPERT_STORE = Symbol('XPERT_STORE')

type Row = Record<string, any>
const EVIDENCE_BUCKET = 'xpert-evidence'

const fail = (what: string, error: { message: string } | null): never => {
  throw new StoreError('failed', `${what}: ${error?.message ?? 'unknown error'}`)
}

/**
 * The records the console reads and changes in the hetzner database: the Xpert, their status and its history.
 * Everything else the store holds lives in the console's own Supabase project.
 */
export interface XpertRecords {
  list(f: ListFilter): Promise<{ rows: XpertSummary[]; total: number }>
  get(id: string): Promise<XpertSummary | null>
  byIds(ids: string[]): Promise<Map<string, XpertSummary>>
  byStatus(status: XpertStatus, limit: number): Promise<XpertSummary[]>
  legacyGuarantor(xpertId: string): Promise<{ name: string; contact: string; relationship: string | null; namedAt: string | null } | null>
  /** Changes the status and writes the history and audit rows in one transaction. Returns the history row id. */
  applyTransition(t: ApplyTransition): Promise<number>
  history(xpertId: string): Promise<Omit<StatusHistoryRow, 'changedByName'>[]>
  lastEntered(xpertIds: string[], status: XpertStatus): Promise<Map<string, string>>
  countByStatus(status: XpertStatus): Promise<number>
  /** Which of these ids exist. Used to catch orphaned or mistyped ids, which no foreign key can. */
  existingIds(ids: string[]): Promise<Set<string>>
  /** Status change audit rows newer than the given time, so the console can copy any it missed. */
  recentStatusAudit(since: Date): Promise<StatusAuditRow[]>
}

export type StatusAuditRow = {
  externalRef: string
  at: string
  actorId: string | null
  xpertId: string
  before: unknown
  after: unknown
  reason: string | null
}

export const XPERT_RECORDS = Symbol('XPERT_RECORDS')

@Injectable()
export class ConsoleXpertStore implements XpertStore {
  constructor(
    private readonly supabase: SupabaseService,
    @Inject(XPERT_RECORDS) private readonly records: XpertRecords,
  ) {}

  private get db() {
    return this.supabase.admin
  }

  // Xpert records (hetzner) ---------------------------------------------------------
  listXperts(f: ListFilter) { return this.records.list(f) }
  getXpert(id: string) { return this.records.get(id) }
  xpertsByIds(ids: string[]) { return this.records.byIds(ids) }
  xpertsByStatus(status: XpertStatus, limit: number) { return this.records.byStatus(status, limit) }
  legacyGuarantor(xpertId: string) { return this.records.legacyGuarantor(xpertId) }

  // Status ----------------------------------------------------------------------
  async applyTransition(t: ApplyTransition) {
    const historyId = await this.records.applyTransition(t)
    // The status and its history are already safe in hetzner. Copy the audit row into the console's
    // own log. If this fails, the hourly sweep copies it later (the unique key stops a duplicate).
    try {
      await this.mirrorAudit([{
        externalRef: `xpert_status:${historyId}`,
        at: new Date().toISOString(),
        actorId: t.actorId,
        xpertId: t.xpertId,
        before: { xpert_status: t.expectedFrom },
        after: { xpert_status: t.to, account_active: t.setActive, trigger: t.trigger },
        reason: t.reason,
      }])
    } catch {
      /* repaired by the sweep */
    }
  }

  /** Writes status change audit rows into the console's audit log. Safe to repeat. Returns how many were new. */
  async mirrorAudit(rows: StatusAuditRow[]): Promise<number> {
    let added = 0
    for (const r of rows) {
      const { data: existing, error: readError } = await this.db.from('audit_log').select('id').eq('metadata->>external_ref', r.externalRef).limit(1)
      if (readError) fail('Could not read the audit log', readError)
      if ((existing ?? []).length > 0) continue
      const { error } = await this.db.from('audit_log').insert({
        occurred_at: r.at,
        actor_id: r.actorId,
        action: 'xpert.status_change',
        entity_type: 'xpert',
        entity_id: r.xpertId,
        before: r.before,
        after: r.after,
        reason: r.reason,
        metadata: { external_ref: r.externalRef, source: 'hetzner' },
      })
      // A concurrent copy hit the unique index. That is the intended guard.
      if (error && error.code !== '23505') fail('Could not write the audit log', error)
      if (!error) added++
    }
    return added
  }

  /** Copies any status change audit rows the console missed. Safe to repeat. */
  async repairAuditMirror(since: Date) { return this.mirrorAudit(await this.records.recentStatusAudit(since)) }
  async existingXpertIds(ids: string[]) { return this.records.existingIds(ids) }

  async history(xpertId: string): Promise<StatusHistoryRow[]> {
    const rows = await this.records.history(xpertId)
    const names = await this.staffNames(rows.map((r) => r.changedBy))
    return rows.map((r) => ({ ...r, changedByName: r.changedBy ? (names.get(r.changedBy) ?? null) : null }))
  }

  lastEntered(xpertIds: string[], status: XpertStatus) { return this.records.lastEntered(xpertIds, status) }

  // Guarantors ------------------------------------------------------------------
  private async toGuarantors(rows: Row[]): Promise<GuarantorRecord[]> {
    const names = await this.staffNames(rows.map((r) => r.assigned_to))
    return rows.map((r) => ({
      id: r.id,
      xpertId: r.xpert_id,
      name: r.name,
      contact: r.contact,
      relationship: r.relationship,
      namedAt: r.named_at,
      explainerMessageSentAt: r.explainer_sent_at,
      callbackConfirmedAt: r.callback_confirmed_at,
      callbackOutcome: (r.callback_outcome ?? null) as CallbackOutcome | null,
      retractedAt: r.retracted_at,
      assignedTo: r.assigned_to,
      assignedToName: r.assigned_to ? (names.get(r.assigned_to) ?? null) : null,
    }))
  }

  async liveGuarantor(xpertId: string) {
    const { data, error } = await this.db.from('guarantor').select('*').eq('xpert_id', xpertId).is('retracted_at', null).maybeSingle()
    if (error) fail('Could not read the guarantor', error)
    return data ? (await this.toGuarantors([data as Row]))[0]! : null
  }

  async guarantorById(id: string) {
    const { data, error } = await this.db.from('guarantor').select('*').eq('id', id).maybeSingle()
    if (error) fail('Could not read the guarantor', error)
    return data ? (await this.toGuarantors([data as Row]))[0]! : null
  }

  async guarantorsFor(xpertIds: string[]) {
    const out = new Map<string, GuarantorRecord>()
    if (xpertIds.length === 0) return out
    const { data, error } = await this.db.from('guarantor').select('*').in('xpert_id', xpertIds).is('retracted_at', null)
    if (error) fail('Could not read guarantors', error)
    for (const g of await this.toGuarantors((data ?? []) as Row[])) out.set(g.xpertId, g)
    return out
  }

  async createGuarantor(g: Parameters<XpertStore['createGuarantor']>[0]) {
    const { data, error } = await this.db
      .from('guarantor')
      .insert({
        xpert_id: g.xpertId,
        name: g.name,
        contact: g.contact,
        relationship: g.relationship,
        ...(g.namedAt ? { named_at: g.namedAt } : {}),
        updated_by: g.actorId,
        change_reason: g.reason,
      })
      .select('*')
      .single()
    if (error) fail('Could not save the guarantor', error)
    return (await this.toGuarantors([data as Row]))[0]!
  }

  async patchGuarantor(id: string, patch: Record<string, unknown>, actorId: string | null, reason: string) {
    const { data, error } = await this.db.from('guarantor').update({ ...patch, updated_by: actorId, change_reason: reason }).eq('id', id).select('*').single()
    if (error) fail('Could not update the guarantor', error)
    return (await this.toGuarantors([data as Row]))[0]!
  }

  // Evidence --------------------------------------------------------------------
  private async toEvidence(rows: Row[]): Promise<EvidenceRecord[]> {
    const names = await this.staffNames(rows.flatMap((r) => [r.reviewed_by, r.assigned_to]))
    return rows.map((r) => ({
      id: r.id,
      xpertId: r.xpert_id,
      taskType: r.task_type,
      evidenceType: r.evidence_type,
      link: r.link,
      filePath: r.file_path,
      reviewOutcome: r.review_outcome as EvidenceOutcome,
      reviewedBy: r.reviewed_by,
      reviewedByName: r.reviewed_by ? (names.get(r.reviewed_by) ?? null) : null,
      reviewedAt: r.reviewed_at,
      autoFailHits: Array.isArray(r.auto_fail_hits) ? r.auto_fail_hits : [],
      assignedTo: r.assigned_to,
      assignedToName: r.assigned_to ? (names.get(r.assigned_to) ?? null) : null,
      createdAt: r.created_at,
    }))
  }

  async evidenceFor(xpertId: string) {
    const { data, error } = await this.db.from('skill_evidence').select('*').eq('xpert_id', xpertId).order('created_at', { ascending: true })
    if (error) fail('Could not read evidence', error)
    return this.toEvidence((data ?? []) as Row[])
  }

  async evidenceById(id: string) {
    const { data, error } = await this.db.from('skill_evidence').select('*').eq('id', id).maybeSingle()
    if (error) fail('Could not read the evidence', error)
    return data ? (await this.toEvidence([data as Row]))[0]! : null
  }

  async pendingEvidence(limit: number) {
    const { data, error } = await this.db.from('skill_evidence').select('*').eq('review_outcome', 'pending').order('created_at', { ascending: true }).limit(limit)
    if (error) fail('Could not read the evidence queue', error)
    return this.toEvidence((data ?? []) as Row[])
  }

  async createEvidence(e: Parameters<XpertStore['createEvidence']>[0]) {
    const { data, error } = await this.db
      .from('skill_evidence')
      .insert({ xpert_id: e.xpertId, task_type: e.taskType, evidence_type: e.evidenceType, link: e.link, file_path: e.filePath, updated_by: e.actorId, change_reason: 'Evidence added' })
      .select('*')
      .single()
    if (error) fail('Could not save the evidence', error)
    return (await this.toEvidence([data as Row]))[0]!
  }

  async patchEvidence(id: string, patch: Record<string, unknown>, actorId: string, reason: string) {
    const { data, error } = await this.db.from('skill_evidence').update({ ...patch, updated_by: actorId, change_reason: reason }).eq('id', id).select('*').single()
    if (error) fail('Could not update the evidence', error)
    return (await this.toEvidence([data as Row]))[0]!
  }

  // References ------------------------------------------------------------------
  private async toReferences(rows: Row[]): Promise<(ReferenceRecord & { callLog: unknown[] })[]> {
    const names = await this.staffNames(rows.flatMap((r) => [r.called_by, r.assigned_to]))
    return rows.map((r) => ({
      id: r.id,
      xpertId: r.xpert_id,
      name: r.name,
      contact: r.contact,
      relationship: r.relationship,
      outcome: r.outcome as ReferenceOutcome,
      attemptsMade: r.attempts_made,
      calledBy: r.called_by,
      calledByName: r.called_by ? (names.get(r.called_by) ?? null) : null,
      calledAt: r.called_at,
      warnings: Array.isArray(r.warnings) ? r.warnings : [],
      assignedTo: r.assigned_to,
      assignedToName: r.assigned_to ? (names.get(r.assigned_to) ?? null) : null,
      createdAt: r.created_at,
      callLog: Array.isArray(r.call_log) ? r.call_log : [],
    }))
  }

  async referencesFor(xpertId: string) {
    const { data, error } = await this.db.from('reference_check').select('*').eq('xpert_id', xpertId).order('created_at', { ascending: true })
    if (error) fail('Could not read references', error)
    return this.toReferences((data ?? []) as Row[])
  }

  async referenceById(id: string) {
    const { data, error } = await this.db.from('reference_check').select('*').eq('id', id).maybeSingle()
    if (error) fail('Could not read the reference', error)
    return data ? (await this.toReferences([data as Row]))[0]! : null
  }

  async pendingReferences(limit: number) {
    const { data, error } = await this.db.from('reference_check').select('*').eq('outcome', 'pending').order('created_at', { ascending: true }).limit(limit)
    if (error) fail('Could not read the reference queue', error)
    return this.toReferences((data ?? []) as Row[])
  }

  async createReference(r: Parameters<XpertStore['createReference']>[0]) {
    const { data, error } = await this.db
      .from('reference_check')
      .insert({ xpert_id: r.xpertId, name: r.name, contact: r.contact, relationship: r.relationship, warnings: r.warnings, updated_by: r.actorId, change_reason: 'Reference added' })
      .select('*')
      .single()
    if (error) fail('Could not save the reference', error)
    return (await this.toReferences([data as Row]))[0]!
  }

  async patchReference(id: string, patch: Record<string, unknown>, actorId: string, reason: string) {
    const { data, error } = await this.db.from('reference_check').update({ ...patch, updated_by: actorId, change_reason: reason }).eq('id', id).select('*').single()
    if (error) fail('Could not update the reference', error)
    return (await this.toReferences([data as Row]))[0]!
  }

  // Counts, config, names, files ---------------------------------------------------
  async cleanCompletedJobs(xpertId: string) {
    const { data, error } = await this.db.from('xpert_reliability').select('clean_jobs').eq('xpert_id', xpertId).maybeSingle()
    if (error) fail('Could not read the reliability record', error)
    return Number((data as Row | null)?.clean_jobs ?? 0)
  }

  async counts() {
    const head = { count: 'exact' as const, head: true }
    const [e, r] = await Promise.all([
      this.db.from('skill_evidence').select('id', head).eq('review_outcome', 'pending'),
      this.db.from('reference_check').select('id', head).eq('outcome', 'pending'),
    ])
    for (const x of [e, r]) if (x.error) fail('Could not count the queues', x.error)
    const [guarantors, approvals] = await Promise.all([this.records.countByStatus('guarantor_pending'), this.records.countByStatus('skill_verification')])
    return { guarantors, evidence: e.count ?? 0, references: r.count ?? 0, approvals }
  }

  async configRows() {
    const { data, error } = await this.db.from('console_config').select('key,value,pending,note,updated_at').order('key')
    if (error) fail('Could not read the settings', error)
    return (data ?? []) as { key: string; value: unknown; pending: boolean; note: string | null; updated_at: string }[]
  }

  async setConfig(key: string, value: unknown, actorId: string, reason: string) {
    // Editing a value settles it: it is no longer marked as pending.
    const { error } = await this.db.from('console_config').update({ value, pending: false, updated_by: actorId, change_reason: reason }).eq('key', key)
    if (error) fail('Could not save the setting', error)
  }

  async staffNames(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((i): i is string => !!i))]
    const out = new Map<string, string>()
    if (unique.length === 0) return out
    const { data, error } = await this.db.from('staff_profile').select('user_id,full_name').in('user_id', unique)
    if (error) fail('Could not read staff names', error)
    for (const r of (data ?? []) as Row[]) out.set(r.user_id, r.full_name)
    return out
  }

  async signedUploadUrl(path: string) {
    const { data, error } = await this.db.storage.from(EVIDENCE_BUCKET).createSignedUploadUrl(path)
    if (error || !data) return fail('Could not prepare the upload', error)
    return { path: data.path, token: data.token, signedUrl: data.signedUrl }
  }

  async signedDownloadUrl(path: string) {
    const { data, error } = await this.db.storage.from(EVIDENCE_BUCKET).createSignedUrl(path, 300)
    if (error || !data) return fail('Could not open the file', error)
    return data.signedUrl
  }
}
