import { Inject, Injectable } from '@nestjs/common'
import type { StatusHistoryRow, XpertStatus, XpertSummary } from '@beyondx/shared'
import { HetznerService } from './hetzner.service'
import { StoreError, type ApplyTransition, type ListFilter, type StatusAuditRow, type XpertRecords } from '../xperts/xpert.store'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)

type Row = Record<string, any>

// Explicit columns only. The database user cannot read the PIN hash or the restricted table, and the
// API never asks for them, so a mistake in one place cannot leak them.
const XPERT_COLUMNS = `
  x.id, x.full_name, x.phone, x.home_area, x.xpert_status, x.account_active, x.verification_source,
  x.activated_at, x.created_at,
  coalesce((
    select array_agg(distinct q.label order by q.label) from (
      select sc.label from xpert_skill s join service_category sc on sc.code = s.category_code
        where s.xpert_id = x.id and s.deleted_at is null
      union
      select tt.label from xpert_skill s join task_type tt on tt.code = s.task_type_code
        where s.xpert_id = x.id and s.deleted_at is null
    ) q
  ), '{}') as skills`

const toXpert = (r: Row): XpertSummary => ({
  id: r.id,
  fullName: String(r.full_name ?? '').trim() || 'Unnamed',
  phone: r.phone ?? null,
  homeArea: r.home_area ?? null,
  skills: (r.skills ?? []) as string[],
  status: r.xpert_status,
  accountActive: !!r.account_active,
  verificationSource: r.verification_source ?? null,
  activatedAt: r.activated_at ? new Date(r.activated_at).toISOString() : null,
  createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
  statusSince: null,
})

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : '')

/** Reads and changes the Xpert records in the hetzner Postgres database. */
@Injectable()
export class PostgresXpertRecords implements XpertRecords {
  constructor(@Inject(HetznerService) private readonly hz: HetznerService) {}

  async list(f: ListFilter) {
    const params: unknown[] = []
    const where = ['x.deleted_at is null']
    if (f.status) { params.push(f.status); where.push(`x.xpert_status = $${params.length}`) }
    if (f.q) {
      const like = `%${f.q.replace(/[\\%_]/g, '\\$&')}%`
      params.push(like)
      where.push(`(x.full_name ilike $${params.length} escape '\\' or x.phone ilike $${params.length} escape '\\' or x.xpert_code ilike $${params.length} escape '\\')`)
    }
    const w = where.join(' and ')
    const total = await this.hz.read.query(`select count(*)::int as n from xpert x where ${w}`, params)
    const rows = await this.hz.read.query(
      `select ${XPERT_COLUMNS} from xpert x where ${w} order by x.created_at desc limit $${params.length + 1} offset $${params.length + 2}`,
      [...params, f.limit, f.offset],
    )
    return { rows: rows.rows.map(toXpert), total: total.rows[0].n as number }
  }

  async get(id: string) {
    if (!isUuid(id)) return null
    const r = await this.hz.read.query(`select ${XPERT_COLUMNS} from xpert x where x.id = $1 and x.deleted_at is null`, [id])
    return r.rows[0] ? toXpert(r.rows[0]) : null
  }

  async byIds(ids: string[]) {
    const out = new Map<string, XpertSummary>()
    const valid = [...new Set(ids.filter(isUuid))]
    if (valid.length === 0) return out
    const r = await this.hz.read.query(`select ${XPERT_COLUMNS} from xpert x where x.id = any($1::uuid[]) and x.deleted_at is null`, [valid])
    for (const row of r.rows) out.set(row.id, toXpert(row))
    return out
  }

  async byStatus(status: XpertStatus, limit: number) {
    const r = await this.hz.read.query(
      `select ${XPERT_COLUMNS} from xpert x where x.xpert_status = $1 and x.deleted_at is null order by x.created_at asc limit $2`,
      [status, limit],
    )
    return r.rows.map(toXpert)
  }

  async legacyGuarantor(xpertId: string) {
    if (!isUuid(xpertId)) return null
    const r = await this.hz.read.query(
      'select guarantor_name, guarantor_phone, guarantor_relationship, created_at from xpert where id = $1 and deleted_at is null',
      [xpertId],
    )
    const row = r.rows[0]
    if (!row || !String(row.guarantor_name ?? '').trim() || !String(row.guarantor_phone ?? '').trim()) return null
    return {
      name: String(row.guarantor_name).trim(),
      contact: String(row.guarantor_phone).trim(),
      relationship: row.guarantor_relationship ?? null,
      namedAt: iso(row.created_at) || null,
    }
  }

  async applyTransition(t: ApplyTransition) {
    if (!isUuid(t.xpertId)) throw new StoreError('not_found', 'Xpert not found')
    try {
      const r = await this.hz.write.query('select xpert_apply_transition($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9) as id', [
        t.xpertId, t.expectedFrom, t.to, t.trigger, t.reason, t.actorId, t.automatic, t.setActive, t.verificationSource ?? null,
      ])
      return Number(r.rows[0].id)
    } catch (e) {
      const err = e as { code?: string; message?: string }
      if (err.code === '40001') throw new StoreError('conflict', err.message ?? 'The status changed.')
      if (err.code === 'P0002') throw new StoreError('not_found', 'Xpert not found')
      throw new StoreError('failed', `Could not change the status: ${err.message ?? 'unknown error'}`)
    }
  }

  async history(xpertId: string): Promise<Omit<StatusHistoryRow, 'changedByName'>[]> {
    if (!isUuid(xpertId)) return []
    const r = await this.hz.read.query(
      'select id, old_status, new_status, changed_by, automatic, trigger, reason, changed_at from xpert_status_history where xpert_id = $1 order by id desc',
      [xpertId],
    )
    return r.rows.map((x) => ({
      id: Number(x.id),
      oldStatus: x.old_status,
      newStatus: x.new_status,
      changedBy: x.changed_by,
      automatic: x.automatic,
      trigger: x.trigger,
      reason: x.reason,
      changedAt: iso(x.changed_at),
    }))
  }

  async lastEntered(xpertIds: string[], status: XpertStatus) {
    const out = new Map<string, string>()
    const valid = [...new Set(xpertIds.filter(isUuid))]
    if (valid.length === 0) return out
    const r = await this.hz.read.query(
      'select xpert_id, max(changed_at) as at from xpert_status_history where new_status = $1 and xpert_id = any($2::uuid[]) group by xpert_id',
      [status, valid],
    )
    for (const x of r.rows) out.set(x.xpert_id, iso(x.at))
    return out
  }

  async countByStatus(status: XpertStatus) {
    const r = await this.hz.read.query('select count(*)::int as n from xpert where xpert_status = $1 and deleted_at is null', [status])
    return r.rows[0].n as number
  }

  async existingIds(ids: string[]) {
    const valid = [...new Set(ids.filter(isUuid))]
    if (valid.length === 0) return new Set<string>()
    const r = await this.hz.read.query('select id from xpert where id = any($1::uuid[])', [valid])
    return new Set<string>(r.rows.map((x) => x.id))
  }

  async recentStatusAudit(since: Date): Promise<StatusAuditRow[]> {
    const r = await this.hz.read.query(
      `select external_ref, at, actor_id, entity_id, before, after, reason from audit_log
        where action = 'xpert.status_change' and external_ref is not null and at >= $1 order by id asc limit 1000`,
      [since],
    )
    return r.rows.map((x) => ({
      externalRef: x.external_ref,
      at: iso(x.at),
      actorId: x.actor_id && isUuid(x.actor_id) ? x.actor_id : null,
      xpertId: x.entity_id,
      before: x.before,
      after: x.after,
      reason: x.reason,
    }))
  }
}
