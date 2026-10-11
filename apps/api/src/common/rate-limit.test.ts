import { describe, expect, it } from 'vitest'
import { rateLimit } from './rate-limit'

const run = (mw: ReturnType<typeof rateLimit>, path = '/x', ip = '1.1.1.1') => {
  const headers: Record<string, string> = {}
  let status = 200
  let nexted = false
  const res: any = { setHeader: (k: string, v: string) => (headers[k] = v), status: (s: number) => ((status = s), res), json: () => res }
  mw({ path, ip } as any, res, () => (nexted = true))
  return { status, nexted, headers }
}

describe('rate limit', () => {
  it('allows up to the limit, then refuses, then recovers after the window', () => {
    let t = 0
    const mw = rateLimit({ windowMs: 1000, max: 3, now: () => t })
    for (let i = 0; i < 3; i++) expect(run(mw).nexted).toBe(true)
    const blocked = run(mw)
    expect(blocked.status).toBe(429)
    expect(blocked.nexted).toBe(false)
    expect(blocked.headers['Retry-After']).toBe('1')
    t = 1001
    expect(run(mw).nexted).toBe(true)
  })
  it('counts each caller separately and never counts the health check', () => {
    const mw = rateLimit({ windowMs: 1000, max: 1 })
    expect(run(mw, '/x', 'a').nexted).toBe(true)
    expect(run(mw, '/x', 'b').nexted).toBe(true)
    for (let i = 0; i < 5; i++) expect(run(mw, '/health', 'a').nexted).toBe(true)
    expect(run(mw, '/x', 'a').status).toBe(429)
  })
})
