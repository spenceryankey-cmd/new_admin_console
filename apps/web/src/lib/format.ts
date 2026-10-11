export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'Just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hr ago`
  const d = Math.round(h / 24)
  return `${d} day${d === 1 ? '' : 's'} ago`
}

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** Keys whose value differs between two JSON objects, for the audit log. */
export function changedKeys(before: unknown, after: unknown): string[] {
  const a = (before && typeof before === 'object' ? before : {}) as Record<string, unknown>
  const b = (after && typeof after === 'object' ? after : {}) as Record<string, unknown>
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
    (k) => k !== 'updated_at' && JSON.stringify(a[k]) !== JSON.stringify(b[k]),
  )
}
