import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { z } from 'zod'
import {
  DEFAULT_MONITOR_CONFIG,
  DEFAULT_QUOTE_VALIDITY_DAYS,
  type MonitorConfig,
  DEFAULT_SCREENING_CONFIG,
  PENDING_CONFIG_KEYS,
  STARTER_CHECKLIST,
  STARTER_REFERENCE_SCRIPT,
  type ConfigEntry,
  type EvidenceChecklist,
  type ScreeningConfig,
  type ScreeningConfigResponse,
} from '@beyondx/shared'
import type { StaffContext } from '../auth/staff-context'
import { XPERT_STORE, type XpertStore } from './xpert.store'

const posInt = z.number().int().min(1).max(3650)
const checklist = z.object({
  items: z.array(z.object({ id: z.string().min(1).max(60), label: z.string().min(1).max(300) })).max(30),
  autoFail: z.array(z.object({ id: z.string().min(1).max(60), label: z.string().min(1).max(300) })).max(30),
})

/** What each stored setting must look like. A bad value is refused, never saved. */
const VALIDATORS: Record<string, z.ZodTypeAny> = {
  'screening.guarantorDeadlineDays': posInt,
  'screening.skillVerificationNudgeDays': posInt,
  'screening.referenceUnreachableAttempts': z.number().int().min(1).max(10),
  'screening.cleanJobsForFullActive': z.number().int().min(1).max(20),
  'screening.reverificationGapDays': posInt.nullable(),
  'screening.underReviewKeepsAccess': z.boolean(),
  'screening.evidenceChecklists': z.record(checklist),
  'screening.referenceScript': z.array(z.string().min(1).max(500)).max(40),
  'quotes.validityDays': z.number().int().min(1).max(30),
  'jobs.startOverdueHours': z.number().int().min(1).max(720),
  'jobs.confirmationOverdueHours': z.number().int().min(1).max(720),
}

export const isConfigKey = (k: string) => k in VALIDATORS

@Injectable()
export class ConfigService {
  constructor(@Inject(XPERT_STORE) private readonly store: XpertStore) {}

  async entries(): Promise<ConfigEntry[]> {
    const rows = await this.store.configRows()
    return rows.map((r) => ({ key: r.key, value: r.value, pending: r.pending, note: r.note, updatedAt: r.updated_at }))
  }

  /** Rules in force. Anything missing or unreadable falls back to the documented default. */
  async screening(): Promise<ScreeningConfigResponse> {
    const rows = new Map((await this.store.configRows()).map((r) => [r.key, r]))
    const config: ScreeningConfig = { ...DEFAULT_SCREENING_CONFIG }
    const pending: string[] = []
    for (const key of Object.keys(DEFAULT_SCREENING_CONFIG) as (keyof ScreeningConfig)[]) {
      const row = rows.get(`screening.${key}`)
      if (row) {
        const parsed = VALIDATORS[`screening.${key}`]!.safeParse(row.value)
        if (parsed.success) (config as Record<string, unknown>)[key] = parsed.data
        if (row.pending) pending.push(key)
      } else if (PENDING_CONFIG_KEYS[key].pending) {
        pending.push(key)
      }
    }
    return { config, pending }
  }

  async checklistFor(taskType: string): Promise<{ checklist: EvidenceChecklist; isStarter: boolean }> {
    const row = (await this.store.configRows()).find((r) => r.key === 'screening.evidenceChecklists')
    const parsed = VALIDATORS['screening.evidenceChecklists']!.safeParse(row?.value ?? {})
    const map = parsed.success ? (parsed.data as Record<string, EvidenceChecklist>) : {}
    const own = map[taskType] ?? map['default']
    return own ? { checklist: own, isStarter: false } : { checklist: STARTER_CHECKLIST, isStarter: true }
  }

  async referenceScript(): Promise<{ lines: string[]; isStarter: boolean }> {
    const row = (await this.store.configRows()).find((r) => r.key === 'screening.referenceScript')
    const parsed = VALIDATORS['screening.referenceScript']!.safeParse(row?.value ?? [])
    const lines = parsed.success ? (parsed.data as string[]) : []
    return lines.length > 0 ? { lines, isStarter: false } : { lines: STARTER_REFERENCE_SCRIPT, isStarter: true }
  }

  /** Days a sent quote stays valid. Decided: three. */
  async quoteValidityDays(): Promise<number> {
    const row = (await this.store.configRows()).find((r) => r.key === 'quotes.validityDays')
    const parsed = VALIDATORS['quotes.validityDays']!.safeParse(row?.value)
    return parsed.success ? (parsed.data as number) : DEFAULT_QUOTE_VALIDITY_DAYS
  }

  async monitor(): Promise<MonitorConfig> {
    const rows = await this.store.configRows()
    const pick = (key: string, fallback: number) => {
      const parsed = VALIDATORS[key]!.safeParse(rows.find((r) => r.key === key)?.value)
      return parsed.success ? (parsed.data as number) : fallback
    }
    return { startOverdueHours: pick('jobs.startOverdueHours', DEFAULT_MONITOR_CONFIG.startOverdueHours), confirmationOverdueHours: pick('jobs.confirmationOverdueHours', DEFAULT_MONITOR_CONFIG.confirmationOverdueHours) }
  }

  async set(actor: StaffContext, key: string, value: unknown, reason: string): Promise<void> {
    const validator = VALIDATORS[key]
    if (!validator) throw new BadRequestException('That setting does not exist.')
    const parsed = validator.safeParse(value)
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? 'That value is not allowed.')
    await this.store.setConfig(key, parsed.data, actor.userId, reason)
  }
}
