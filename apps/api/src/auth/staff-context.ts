import type { AssuranceLevel, Permission, Role } from '@beyondx/shared'

/** The signed in staff member, attached to the request by AuthGuard. */
export type StaffContext = {
  userId: string
  email: string
  fullName: string
  role: Role
  isActive: boolean
  permissions: ReadonlySet<Permission>
  /** How this session signed in. Set by AuthGuard. */
  aal?: AssuranceLevel
}

export type RequestWithStaff = {
  headers: Record<string, string | string[] | undefined>
  ip?: string
  staff?: StaffContext
}
