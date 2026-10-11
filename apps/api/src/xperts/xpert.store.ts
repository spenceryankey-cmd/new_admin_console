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
import { ENV, type Env } from '../config/env'
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

@Injectable()
export class SupabaseXpertStore implements XpertStore {
  private readonly nameCols: string[]

  constructor(
    private readonly supabase: SupabaseService,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.nameCols = env.XPERT_NAME_COLUMNS.split(',')
  }

  private get db() {
    return this.supabase.admin
  }

  // Xpert records ---------------------------------------------------------------
  private xpertSelect(): string {
    const e = this.env
    const parts = [
      `xp_id:${e.XPERT_ID_COLUMN}`,
      ...this.nameCols.map((c, i) => `xp_n${i}:${c}`),
      `xp_phone:${e.XPERT_PHONE_COLUMN}`,
      `xp_created:${e.XPERT_CREATED_COLUMN}`,
      'xpert_status',
      'account_active',
      'activated_at',
      'verification_source',
    ]
    if (e.XPERT_AREA_COLUMN) parts.push(`xp_area:${e.XPERT_AREA_COLUMN}`)
    if (e.XPERT_SKILLS_COLUMN) parts.push(`xp_skills:${e.XPERT_SKILLS_COLUMN}`)
    return parts.join(',')
  }

  private toXpert(r: Row): XpertSummary {
    const skills = r.xp_skills
    return {
      id: String(r.xp_id),
      fullName: this.nameCols.map((_, i) => r[`xp_n${i}`]).filter(Boolean).join(' ').trim() || 'Unnamed',
      phone: r.xp_phone ?? null,
      homeArea: r.xp_area ?? null,
      skills: Array.isArray(skills) ? skills.map(String) : typeof skills === 'string' && skills ? skills.split(',').map((s) => s.trim()) : [],
      status: r.xpert_status,
      accountActive: !!r.account_active,
      verificationSource: r.verification_source ?? null,
      activatedAt: r.activated_at ?? null,
      createdAt: r.xp_created ?? null,
      statusSince: null,
    }
  }

  async listXperts(f: ListFilter) {
    let q = this.db.from(this.env.XPERT_TABLE).select(this.xpertSelect(), { count: 'exact' })
    if (f.status) q = q.eq('xpert_status', f.status)
    if (f.q) {
      const safe = f.q.replace(/[^\p{L}\p{N} +@.-]/gu, '')
      if (safe) {
        const cols = [...this.nameCols, this.env.XPERT_PHONE_COLUMN]
        q = q.or(cols.map((c) => `${c}.ilike.%${safe}%`).join(','))
      }
    }
    const { data, error, count } = await q
      .order(this.env.XPERT_CREATED_COLUMN, { ascending: false })
      .range(f.offset, f.offset + f.limit - 1)
    if (error) fail('Could not read Xperts', error)
    return { rows: ((data ?? []) as unknown as Row[]).map((r) => this.toXpert(r)), total: count ?? 0 }
  }

  async getXpert(id: string) {
    const { data, error } = await this.db.from(this.env.XPERT_TABLE).select(this.xpertSelect()).eq(this.env.XPERT_ID_COLUMN, id).maybeSingle()
    if (error) fail('Could not read the Xpert', error)
    return data ? this.toXpert(data as unknown as Row) : null
  }

  async xpertsByIds(ids: string[]) {
    const out = new Map<string, XpertSummary>()
    if (ids.length === 0) return out
    const { data, error } = await this.db.from(this.env.XPERT_TABLE).select(this.xpertSelect()).in(this.env.XPERT_ID_COLUMN, ids)
    if (error) fail('Could not read Xperts', error)
    for (const r of (data ?? []) as unknown as Row[]) {
      const x = this.toXpert(r)
      out.set(x.id, x)
    }
    return out
  }

  async xpertsByStatus(status: XpertStatus, limit: number) {
    const { data, error } = await this.db
      .from(this.env.XPERT_TABLE)
      .select(this.xpertSelect())
      .eq('xpert_status', status)
      .order(this.env.XPERT_CREATED_COLUMN, { ascending: true })
      .limit(limit)
    if (error) fail('Could not read Xperts', error)
    return ((data ?? []) as unknown as Row[]).map((r) => this.toXpert(r))
  }

  async legacyGuarantor(xpertId: string) {
    const e = this.env
    if (!e.XPERT_GUARANTOR_NAME_COLUMN || !e.XPERT_GUARANTOR_CONTACT_COLUMN) return null
    const cols = [`g_name:${e.XPERT_GUARANTOR_NAME_COLUMN}`, `g_contact:${e.XPERT_GUARANTOR_CONTACT_COLUMN}`, `g_created:${e.XPERT_CREATED_COLUMN}`]
    if (e.XPERT_GUARANTOR_RELATIONSHIP_COLUMN) cols.push(`g_rel:${e.XPERT_GUARANTOR_RELATIONSHIP_COLUMN}`)
    const { data, error } = await this.db.from(e.XPERT_TABLE).select(cols.join(',')).eq(e.XPERT_ID_COLUMN, xpertId).maybeSingle()
    if (error) fail('Could not read the guarantor details', error)
    const r = data as unknown as Row | null
    if (!r || !String(r.g_name ?? '').trim() || !String(r.g_contact ?? '').trim()) return null
    return { name: String(r.g_name).trim(), contact: String(r.g_contact).trim(), relationship: r.g_rel ?? null, namedAt: r.g_created ?? null }
  }

  // Status ----------------------------------------------------------------------
  async applyTransition(t: ApplyTransition) {
    const { error } = await this.db.rpc('xpert_apply_transition', {
      p_xpert_id: t.xpertId,
      p_expected_from: t.expectedFrom,
      p_to: t.to,
      p_trigger: t.trigger,
      p_reason: t.reason,
      p_actor: t.actorId,
      p_automatic: t.automatic,
      p_set_active: t.setActive,
      p_verification_src: t.verificationSource ?? null,
    })
    if (!error) return
    if (error.code === '40001') throw new StoreError('conflict', error.message)
    if (error.code === 'P0002') throw new StoreError('not_found', 'Xpert not found')
    fail('Could not change the status', error)
  }

  async history(xpertId: string): Promise<StatusHistoryRow[]> {
    const { data, error } = await this.db.from('status_history').select('*').eq('xpert_id', xpertId).order('id', { ascending: false })
    if (error) fail('Could not read the status history', error)
    const rows = (data ?? []) as Row[]
    const names = await this.staffNames(rows.map((r) => r.changed_by))
    return rows.map((r) => ({
      id: r.id,
      oldStatus: r.old_status,
      newStatus: r.new_status,
      changedBy: r.changed_by,
      changedByName: r.changed_by ? (names.get(r.changed_by) ?? null) : null,
      automatic: r.automatic,
      trigger: r.trigger,
      reason: r.reason,
      changedAt: r.changed_at,
    }))
  }

  async lastEntered(xpertIds: string[], status: XpertStatus) {
    const out = new Map<string, string>()
    if (xpertIds.length === 0) return out
    const { data, error } = await this.db
      .from('status_history')
      .select('xpert_id,changed_at')
      .eq('new_status', status)
      .in('xpert_id', xpertIds)
      .order('id', { ascending: true })
    if (error) fail('Could not read the status history', error)
    for (const r of (data ?? []) as Row[]) out.set(r.xpert_id, r.changed_at) // later rows overwrite earlier ones
    return out
  }

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
    const [g, e, r, a] = await Promise.all([
      this.db.from(this.env.XPERT_TABLE).select('xpert_status', head).eq('xpert_status', 'guarantor_pending'),
      this.db.from('skill_evidence').select('id', head).eq('review_outcome', 'pending'),
      this.db.from('reference_check').select('id', head).eq('outcome', 'pending'),
      this.db.from(this.env.XPERT_TABLE).select('xpert_status', head).eq('xpert_status', 'skill_verification'),
    ])
    for (const x of [g, e, r, a]) if (x.error) fail('Could not count the queues', x.error)
    return { guarantors: g.count ?? 0, evidence: e.count ?? 0, references: r.count ?? 0, approvals: a.count ?? 0 }
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
