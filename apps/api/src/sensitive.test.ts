import 'reflect-metadata'
import type { INestApplication } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { NEVER_RETURNED_FIELDS, findSensitiveKeys } from '@beyondx/shared'
import { buildMockApp } from './dev/mock-app'
import { AuditController } from './audit/audit.controller'
import { PricingController, RequestsController } from './requests/requests.controller'
import { ChangeOrdersController, JobsController, RecurringController } from './jobs/jobs.controller'
import { CoordinatorsController, FeedbackController, FlagsController, ReliabilityController } from './trust/trust.controller'
import { MeController } from './me.controller'
import { RolesController } from './roles/roles.controller'
import { StaffController } from './staff/staff.controller'
import { ConfigController, EvidenceController, GuarantorsController, QueuesController, ReferencesController, SweepsController, XpertsController } from './xperts/xperts.controller'

const controllers = [MeController, StaffController, RolesController, AuditController, XpertsController, QueuesController, GuarantorsController, EvidenceController, ReferencesController, ConfigController, SweepsController, RequestsController, PricingController, JobsController, ChangeOrdersController, RecurringController, FlagsController, FeedbackController, ReliabilityController, CoordinatorsController]

type Route = { name: string; path: string }
const GET = 0
function getRoutes(): Route[] {
  const out: Route[] = []
  for (const c of controllers) {
    const base = String(Reflect.getMetadata('path', c) ?? '')
    for (const n of Object.getOwnPropertyNames(c.prototype).filter((x) => x !== 'constructor')) {
      const h = (c.prototype as unknown as Record<string, unknown>)[n]
      if (typeof h !== 'function' || Reflect.getMetadata('path', h) === undefined || Reflect.getMetadata('method', h) !== GET) continue
      const sub = String(Reflect.getMetadata('path', h))
      out.push({ name: `${c.name}.${n}`, path: `/${[base, sub].filter((p) => p && p !== '/').join('/')}`.replace(/\/+/g, '/') })
    }
  }
  return out
}

const ids = new Set<string>()
function harvest(v: unknown) {
  if (Array.isArray(v)) return v.forEach(harvest)
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if ((k === 'id' || k.endsWith('Id')) && (typeof x === 'string' || typeof x === 'number') && ids.size < 60) ids.add(String(x))
      harvest(x)
    }
  }
}

describe('sensitive fields are never returned', () => {
  let app: INestApplication
  let base = ''
  beforeAll(async () => {
    app = await buildMockApp('super_admin')
    await app.listen(0)
    base = (await app.getUrl()).replace('[::1]', 'localhost')
  })
  afterAll(async () => {
    await app?.close()
  })

  it('the list is not empty and the finder works at any depth', () => {
    expect(NEVER_RETURNED_FIELDS.length).toBeGreaterThan(10)
    expect(findSensitiveKeys({ a: [{ b: { id_hash: 'x' } }], ok: 1 })).toEqual(['$.a[0].b.id_hash'])
    expect(findSensitiveKeys({ ID_Verification_Ref: 'x', 'access-token': 'y' })).toHaveLength(2)
    expect(findSensitiveKeys({ idLast4: '1234', fullName: 'A' })).toEqual([])
  })

  it('no read route sends a listed field (signed in as super_admin, which can read every route)', async () => {
    const routes = getRoutes()
    expect(routes.length).toBeGreaterThan(30)
    const leaks: string[] = []
    let ok = 0

    const call = async (path: string) => {
      const res = await fetch(`${base}${path}`, { headers: { authorization: 'Bearer test' } })
      if (res.status >= 500) throw new Error(`${path} failed with ${res.status}`)
      if (!res.ok) return null
      const body: unknown = await res.json().catch(() => null)
      if (body === null) return null
      ok++
      harvest(body)
      for (const k of findSensitiveKeys(body)) leaks.push(`${path} ${k}`)
      return body
    }

    // First the routes with no parameter, which gather real ids from the sample data.
    for (const r of routes.filter((x) => !x.path.includes(':'))) await call(r.path)
    // Then the routes with a parameter, tried with every id seen so far.
    for (const r of routes.filter((x) => x.path.includes(':'))) {
      for (const id of [...ids]) await call(r.path.replace(/:[A-Za-z]+/g, encodeURIComponent(id)))
    }

    expect(leaks).toEqual([])
    expect(ok).toBeGreaterThan(30) // proves the crawl really read data
  }, 60_000)
})
