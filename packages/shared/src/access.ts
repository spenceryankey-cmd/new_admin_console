// Single source of truth for roles and permissions.
//
// The API reads live grants from the role_permission table, so a super_admin can
// change them. The defaults below seed that table (see
// supabase/migrations/0001_staff_roles_audit.sql) and are used in tests. A test
// checks that the migration seed and these defaults agree.

export const ROLES = ['ops_reviewer', 'decision_maker', 'finance_approver', 'super_admin'] as const
export type Role = (typeof ROLES)[number]

export const ROLE_LABELS: Record<Role, string> = {
  ops_reviewer: 'Operations reviewer',
  decision_maker: 'Decision maker',
  finance_approver: 'Finance approver',
  super_admin: 'Super admin',
}

export const PERMISSIONS = [
  'dashboard.view',
  'xperts.read',
  'guarantors.review',
  'evidence.review',
  'references.review',
  'xperts.approve',
  'xperts.status.decide',
  'xperts.status.voluntary',
  'flags.read',
  'flags.raise',
  'flags.decide',
  'reliability.read',
  'quotes.read',
  'quotes.compose',
  'payments.record',
  'pricing.bands.edit',
  'benchmarks.edit',
  'dispatch.match',
  'jobs.monitor',
  'jobs.replace',
  'changeorders.manage',
  'coordinators.read',
  'coordinators.manage',
  'feedback.read',
  'settings.read',
  'settings.edit',
  'staff.read',
  'staff.manage',
  'audit.read',
] as const
export type Permission = (typeof PERMISSIONS)[number]

export const PERMISSION_LABELS: Record<Permission, string> = {
  'dashboard.view': 'View the dashboard',
  'xperts.read': 'View Xperts and their records',
  'guarantors.review': 'Work the guarantor queue',
  'evidence.review': 'Review skill evidence',
  'references.review': 'Make and log reference calls',
  'xperts.approve': 'Approve or revoke an Xpert',
  'xperts.status.decide': 'Decide Under Review, Suspended and Removed',
  'xperts.status.voluntary': 'Log an Xpert going inactive or returning',
  'flags.read': 'View flags',
  'flags.raise': 'Raise a flag or a counter flag',
  'flags.decide': 'Investigate and resolve flags',
  'reliability.read': 'View reliability records',
  'quotes.read': 'View requests and quotes',
  'quotes.compose': 'Prepare and send quotes',
  'payments.record': 'Record that an employer payment has arrived',
  'pricing.bands.edit': 'Edit Xpert price bands',
  'benchmarks.edit': 'Edit benchmark rates',
  'dispatch.match': 'Match and dispatch Xperts',
  'jobs.monitor': 'Monitor live jobs',
  'jobs.replace': 'Replace an Xpert on a job',
  'changeorders.manage': 'Log change orders',
  'coordinators.read': 'View coordinators and their metrics',
  'coordinators.manage': 'Add coordinators and assign Xperts to them',
  'feedback.read': 'View feedback',
  'settings.read': 'View settings',
  'settings.edit': 'Edit settings',
  'staff.read': 'View staff and roles',
  'staff.manage': 'Invite staff and change roles',
  'audit.read': 'View the audit log',
}

// Quote composing is held by every role that can see the dashboard (decided in
// Phase 3). A super_admin can still take it away from a role on the Roles screen.
// super_admin always has everything.
export const DEFAULT_ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ops_reviewer: [
    'dashboard.view',
    'xperts.read',
    'guarantors.review',
    'evidence.review',
    'references.review',
    'xperts.status.voluntary',
    'flags.read',
    'flags.raise',
    'reliability.read',
    'quotes.read',
    'quotes.compose',
    'dispatch.match',
    'jobs.monitor',
    'jobs.replace',
    'changeorders.manage',
    'coordinators.read',
    'feedback.read',
  ],
  decision_maker: [
    'dashboard.view',
    'xperts.read',
    'xperts.approve',
    'xperts.status.decide',
    'xperts.status.voluntary',
    'quotes.read',
    'quotes.compose',
    'jobs.monitor',
    'dispatch.match',
    'flags.read',
    'flags.raise',
    'flags.decide',
    'reliability.read',
    'coordinators.read',
    'coordinators.manage',
    'feedback.read',
  ],
  finance_approver: ['dashboard.view', 'quotes.read', 'quotes.compose', 'payments.record', 'jobs.monitor', 'reliability.read'],
  super_admin: PERMISSIONS,
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
}

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && (PERMISSIONS as readonly string[]).includes(value)
}

/** Permission check. super_admin passes everything, including future permissions. */
export function can(
  subject: { role: Role; permissions: ReadonlySet<Permission> | readonly Permission[] },
  needed: Permission | readonly Permission[],
): boolean {
  if (subject.role === 'super_admin') return true
  const have = subject.permissions instanceof Set ? subject.permissions : new Set(subject.permissions)
  const list = Array.isArray(needed) ? needed : [needed as Permission]
  return list.every((p) => have.has(p))
}
