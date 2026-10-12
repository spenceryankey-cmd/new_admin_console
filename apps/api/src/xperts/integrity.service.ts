import { Inject, Injectable } from '@nestjs/common'
import { SupabaseService } from '../supabase/supabase.service'
import { XPERT_STORE, type XpertStore } from './xpert.store'

/** Console tables that hold an Xpert id. The id points into the hetzner database, so no foreign key can protect it. */
export const XPERT_REFERENCES = [
  'guarantor', 'skill_evidence', 'reference_check', 'price_band', 'job', 'assignment', 'recurring_service', 'coordinator_xpert', 'flag',
] as const

export type OrphanReport = { checked: number; orphans: { table: string; xpertId: string }[] }

/** Pure check: which referenced ids are missing from the Xpert database. Nothing is ever deleted or changed. */
export function findOrphans(refs: Map<string, string[]>, existing: Set<string>): OrphanReport {
  const orphans: OrphanReport['orphans'] = []
  let checked = 0
  for (const [table, ids] of refs) {
    for (const xpertId of new Set(ids)) {
      checked++
      if (!existing.has(xpertId)) orphans.push({ table, xpertId })
    }
  }
  return { checked, orphans }
}

@Injectable()
export class IntegrityService {
  constructor(
    @Inject(XPERT_STORE) private readonly store: XpertStore,
    private readonly supabase: SupabaseService,
  ) {}

  /** Reports console rows whose Xpert id does not exist in the Xpert database (orphaned or mistyped). Read only. */
  async check(): Promise<OrphanReport> {
    const refs = new Map<string, string[]>()
    for (const table of XPERT_REFERENCES) {
      const { data, error } = await this.supabase.admin.from(table).select('xpert_id').not('xpert_id', 'is', null).limit(20_000)
      if (error) throw new Error(`Could not read ${table}: ${error.message}`)
      refs.set(table, ((data ?? []) as { xpert_id: string }[]).map((r) => String(r.xpert_id)))
    }
    // The backup Xpert on a job is a second Xpert id on the same table.
    const { data: backups, error: be } = await this.supabase.admin.from('job').select('backup_xpert_id').not('backup_xpert_id', 'is', null).limit(20_000)
    if (be) throw new Error(`Could not read job backups: ${be.message}`)
    refs.set('job (backup)', ((backups ?? []) as { backup_xpert_id: string }[]).map((r) => String(r.backup_xpert_id)))
    const all = [...new Set([...refs.values()].flat())]
    const existing = new Set<string>()
    for (let i = 0; i < all.length; i += 500) {
      for (const id of await this.store.existingXpertIds(all.slice(i, i + 500))) existing.add(id)
    }
    return findOrphans(refs, existing)
  }
}
