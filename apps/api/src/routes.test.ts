import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import { ANY_STAFF, IS_PUBLIC, REQUIRED_PERMISSIONS } from './auth/decorators'
import { isPermission } from '@beyondx/shared'
import { AuditController } from './audit/audit.controller'
import { PricingController, RequestsController } from './requests/requests.controller'
import { ChangeOrdersController, JobsController, RecurringController } from './jobs/jobs.controller'
import { CoordinatorsController, FeedbackController, FlagsController, ReliabilityController } from './trust/trust.controller'
import { MeController } from './me.controller'
import { RolesController } from './roles/roles.controller'
import { StaffController } from './staff/staff.controller'
import {
  ConfigController, EvidenceController, GuarantorsController, QueuesController, ReferencesController, SweepsController, XpertsController,
} from './xperts/xperts.controller'

const controllers = [MeController, StaffController, RolesController, AuditController, XpertsController, QueuesController, GuarantorsController, EvidenceController, ReferencesController, ConfigController, SweepsController, RequestsController, PricingController, JobsController, ChangeOrdersController, RecurringController, FlagsController, FeedbackController, ReliabilityController, CoordinatorsController]

describe('every route declares who may call it', () => {
  for (const c of controllers) {
    for (const name of Object.getOwnPropertyNames(c.prototype).filter((n) => n !== 'constructor')) {
      const handler = (c.prototype as any)[name]
      if (Reflect.getMetadata('path', handler) === undefined) continue // not a route
      it(`${c.name}.${name}`, () => {
        const perms = Reflect.getMetadata(REQUIRED_PERMISSIONS, handler) as string[] | undefined
        const declared = Reflect.getMetadata(IS_PUBLIC, handler) || Reflect.getMetadata(ANY_STAFF, handler) || (perms && perms.length > 0)
        expect(declared).toBeTruthy()
        for (const p of perms ?? []) expect(isPermission(p)).toBe(true)
      })
    }
  }
})

describe('nothing can be hard deleted through the API', () => {
  it('no controller exposes a DELETE route', () => {
    const DELETE = 3 // RequestMethod.DELETE
    for (const c of controllers) {
      for (const name of Object.getOwnPropertyNames(c.prototype).filter((n) => n !== 'constructor')) {
        const handler = (c.prototype as any)[name]
        if (Reflect.getMetadata('path', handler) === undefined) continue
        expect(Reflect.getMetadata('method', handler), `${c.name}.${name}`).not.toBe(DELETE)
      }
    }
  })
})

describe('every controller is covered by this file', () => {
  it('lists each controller registered in the app module', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join(__dirname, 'app.module.ts'), 'utf8')
    const block = src.slice(src.indexOf('controllers:'), src.indexOf(']', src.indexOf('controllers:')))
    const registered = [...block.matchAll(/\b([A-Z]\w*Controller)\b/g)].map((m) => m[1])
    const covered = controllers.map((c) => c.name)
    expect(registered.filter((n) => !covered.includes(n!))).toEqual([])
  })
})
