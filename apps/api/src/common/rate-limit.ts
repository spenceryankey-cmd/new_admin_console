import type { NextFunction, Request, Response } from 'express'

export type RateLimitOptions = { windowMs: number; max: number; now?: () => number }

/**
 * A small fixed window limiter keyed by caller address. It slows down guessing and runaway
 * scripts. It is per process, which is enough for one Railway instance. Requests the health
 * check makes are never counted.
 */
export function rateLimit(opts: RateLimitOptions) {
  const now = opts.now ?? Date.now
  const hits = new Map<string, { count: number; resetAt: number }>()
  let lastSweep = now()
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/health') return next()
    const t = now()
    if (t - lastSweep > opts.windowMs) {
      for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k)
      lastSweep = t
    }
    const key = req.ip || 'unknown'
    let e = hits.get(key)
    if (!e || e.resetAt <= t) {
      e = { count: 0, resetAt: t + opts.windowMs }
      hits.set(key, e)
    }
    e.count++
    res.setHeader('RateLimit-Limit', String(opts.max))
    res.setHeader('RateLimit-Remaining', String(Math.max(0, opts.max - e.count)))
    if (e.count > opts.max) {
      res.setHeader('Retry-After', String(Math.ceil((e.resetAt - t) / 1000)))
      return res.status(429).json({ message: 'Too many requests. Wait a moment and try again.' })
    }
    next()
  }
}
