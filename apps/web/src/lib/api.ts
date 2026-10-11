import { supabase } from './supabase'

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')
const OFFLINE = 'No connection. Check your internet and try again.'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function once<T>(path: string, method: string, body: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(OFFLINE, 0)
  }
  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const message =
      json && typeof json === 'object' && 'message' in json && typeof (json as { message: unknown }).message === 'string'
        ? (json as { message: string }).message
        : `Something went wrong (${res.status})`
    throw new ApiError(message, res.status)
  }
  return json as T
}

/**
 * Reads retry twice on a dropped connection or a server error, which is common on
 * mobile data. Writes are never retried automatically, so an action can never be
 * applied twice without the person seeing it.
 */
export async function api<T>(path: string, opts: { method?: 'GET' | 'POST' | 'PATCH' | 'PUT'; body?: unknown } = {}): Promise<T> {
  const method = opts.method ?? 'GET'
  if (method !== 'GET') return once<T>(path, method, opts.body)
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await once<T>(path, method, undefined)
    } catch (e) {
      lastError = e
      const retryable = e instanceof ApiError && (e.status === 0 || e.status >= 500)
      if (!retryable || attempt === 2) break
      await sleep(600 * (attempt + 1))
    }
  }
  throw lastError
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong')
