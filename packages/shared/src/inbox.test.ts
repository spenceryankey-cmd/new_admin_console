import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_ROLE_PERMISSIONS, NOTIFICATION_AUDIENCES, describeAudience, notificationAudienceSchema, sendNotificationSchema, can } from './index'

describe('inbox and notification permissions', () => {
  it('lets ops reviewers work the inbox but not send notifications', () => {
    const ops = DEFAULT_ROLE_PERMISSIONS.ops_reviewer
    expect(ops).toContain('inbox.read')
    expect(ops).toContain('inbox.handle')
    expect(ops).not.toContain('notifications.send')
  })
  it('lets only decision makers and super admins send notifications', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.decision_maker).toContain('notifications.send')
    expect(DEFAULT_ROLE_PERMISSIONS.finance_approver).not.toContain('notifications.send')
    expect(DEFAULT_ROLE_PERMISSIONS.finance_approver).not.toContain('inbox.read')
    expect(can({ role: 'super_admin', permissions: new Set() }, 'notifications.send')).toBe(true)
  })
  it('seeds the same grants in migration 0012', () => {
    const sql = readFileSync(resolve(__dirname, '../../../supabase/migrations/0012_inbox_notifications.sql'), 'utf8')
    for (const p of ['inbox.read', 'inbox.handle', 'notifications.send']) {
      const seeded = [...sql.matchAll(new RegExp(`\\('([a-z_]+)',\\s+'${p.replace('.', '\\.')}'\\)`, 'g'))].map((m) => m[1]).filter((r) => r !== 'super_admin').sort()
      const defaults = (['ops_reviewer', 'decision_maker', 'finance_approver'] as const).filter((r) => DEFAULT_ROLE_PERMISSIONS[r].includes(p as never)).sort()
      expect(seeded, p).toEqual(defaults)
    }
  })
})

describe('notification audiences', () => {
  it('covers every kind, and describes each in plain words', () => {
    expect(NOTIFICATION_AUDIENCES).toHaveLength(5)
    expect(describeAudience({ kind: 'all_xperts' })).toBe('All Xperts')
    expect(describeAudience({ kind: 'xperts_in_category', category: 'Skilled Trades' })).toBe('Xperts in Skilled Trades')
  })
  it('rejects an audience with no id, an unlisted category, or an unknown kind', () => {
    expect(notificationAudienceSchema.safeParse({ kind: 'xpert' }).success).toBe(false)
    expect(notificationAudienceSchema.safeParse({ kind: 'xperts_in_category', category: 'Gardening' }).success).toBe(false)
    expect(notificationAudienceSchema.safeParse({ kind: 'staff' }).success).toBe(false)
    expect(sendNotificationSchema.safeParse({ audience: { kind: 'employer', id: 'e1' }, body: 'Hello', confirmRecipients: 1 }).success).toBe(true)
  })
})
