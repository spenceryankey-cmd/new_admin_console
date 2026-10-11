import type { Permission, Role } from '@beyondx/shared'

/** The signed in staff member, attached to the request by AuthGuard. */
export type StaffContext = {
  userId: string
  email: string
  fullName: string
  role: Role
  isActive: boolean
  permissions: ReadonlySet<Permission>
}

export type RequestWithStaff = {
  headers: Record<string, string | string[] | undefined>
  ip?: string
  staff?: StaffContext
}
