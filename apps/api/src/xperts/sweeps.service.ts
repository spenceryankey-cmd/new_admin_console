import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { ENV, type Env } from '../config/env'
import { XPERT_STORE, type XpertStore } from './xpert.store'
import { XpertsService } from './xperts.service'
import { RequestsService } from '../requests/requests.service'
import { JobsService } from '../jobs/jobs.service'
import { IntegrityService } from './integrity.service'

export type SweepResult = { guarantorsImported: number; movedToGuarantorPending: number; closedAtDeadline: number; movedToSkillVerification: number; promotedToFullActive: number; quotesExpired: number; recurringGenerated: number; auditCopied: number; orphanedReferences: number }

const BATCH = 200

/**
 * Moves that depend on time or on data that arrives outside the console. Safe to run
 * as often as you like and from more than one place: every move is checked against the
 * rules and applied atomically, so a repeat does nothing.
 */
@Injectable()
export class SweepsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Sweeps')
  private timer: NodeJS.Timeout | null = null
  private running = false

  constructor(
    @Inject(XPERT_STORE) private readonly store: XpertStore,
    private readonly xperts: XpertsService,
    @Inject(ENV) private readonly env: Env,
    private readonly requests: RequestsService,
    private readonly jobs: JobsService,
    private readonly integrity: IntegrityService,
  ) {}

  onModuleInit() {
    if (this.env.SWEEPS_ENABLED !== 'true') return
    this.timer = setInterval(() => void this.safeRun(), 60 * 60 * 1000)
    this.timer.unref()
    setTimeout(() => void this.safeRun(), 30_000).unref()
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  private async safeRun() {
    try {
      const r = await this.run()
      this.log.log(`Sweep done ${JSON.stringify(r)}`)
    } catch (e) {
      this.log.error(`Sweep failed: ${(e as Error).message}`)
    }
  }

  async run(): Promise<SweepResult> {
    if (this.running) throw new Error('A sweep is already running.')
    this.running = true
    try {
      const out: SweepResult = { guarantorsImported: 0, movedToGuarantorPending: 0, closedAtDeadline: 0, movedToSkillVerification: 0, promotedToFullActive: 0, quotesExpired: 0, recurringGenerated: 0, auditCopied: 0, orphanedReferences: 0 }

      for (const x of await this.store.xpertsByStatus('applied', BATCH)) {
        let g = await this.store.liveGuarantor(x.id)
        if (!g) {
          const legacy = await this.store.legacyGuarantor(x.id)
          if (legacy) {
            g = await this.store.createGuarantor({ xpertId: x.id, ...legacy, actorId: null, reason: 'Copied from the application' })
            out.guarantorsImported++
          }
        }
        if (g && (await this.xperts.system(x.id, 'guarantor_pending', 'guarantor_named', 'Guarantor named'))) out.movedToGuarantorPending++
      }

      for (const x of await this.store.xpertsByStatus('guarantor_pending', BATCH)) {
        if (await this.xperts.system(x.id, 'blocked_closed', 'guarantor_deadline_passed', 'The guarantor was not confirmed within the deadline')) out.closedAtDeadline++
      }

      for (const x of await this.store.xpertsByStatus('guarantor_confirmed', BATCH)) {
        if (await this.xperts.system(x.id, 'skill_verification', 'screening_started', 'Guarantor confirmed')) out.movedToSkillVerification++
      }

      for (const x of await this.store.xpertsByStatus('provisional_active', BATCH)) {
        const before = x.status
        await this.xperts.afterScreeningEvent(x.id)
        const after = await this.store.getXpert(x.id)
        if (after && after.status !== before) out.promotedToFullActive++
      }
      out.quotesExpired = await this.requests.expireDue()
      out.recurringGenerated = await this.jobs.generateDue()
      // Copy any status change audit rows the console missed (the status and history are already safe in the Xpert database).
      out.auditCopied = await this.store.repairAuditMirror(new Date(Date.now() - 48 * 3_600_000))
      // Report, never fix, ids that point at an Xpert that does not exist.
      const report = await this.integrity.check()
      out.orphanedReferences = report.orphans.length
      if (report.orphans.length > 0) this.log.warn(`Orphaned Xpert references: ${report.orphans.slice(0, 20).map((o) => `${o.table}:${o.xpertId}`).join(', ')}`)
      return out
    } finally {
      this.running = false
    }
  }
}
