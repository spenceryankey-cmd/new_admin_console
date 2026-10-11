import { z } from 'zod'
import { PERMISSIONS, ROLES } from './access'

const reason = z.string().trim().min(3, 'Give a reason of at least 3 characters').max(500)

export const inviteStaffSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  fullName: z.string().trim().min(2, 'Enter a full name').max(120),
  role: z.enum(ROLES),
})
export type InviteStaffInput = z.infer<typeof inviteStaffSchema>

export const updateStaffSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120).optional(),
    role: z.enum(ROLES).optional(),
    isActive: z.boolean().optional(),
    reason,
  })
  .refine((v) => v.fullName !== undefined || v.role !== undefined || v.isActive !== undefined, {
    message: 'Nothing to change',
  })
export type UpdateStaffInput = z.infer<typeof updateStaffSchema>

export const setRolePermissionSchema = z.object({
  granted: z.boolean(),
  reason,
})
export type SetRolePermissionInput = z.infer<typeof setRolePermissionSchema>

export const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.number().int().positive().optional(),
  entityType: z.string().trim().max(80).optional(),
  actorId: z.string().uuid().optional(),
})
export type AuditQuery = z.infer<typeof auditQuerySchema>

export const permissionParam = z.enum(PERMISSIONS)
export const roleParam = z.enum(ROLES)

// Shapes returned by the API, shared with the web app.
export type StaffMember = {
  userId: string
  email: string
  fullName: string
  role: (typeof ROLES)[number]
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type MeResponse = {
  staff: Pick<StaffMember, 'userId' | 'email' | 'fullName' | 'role' | 'isActive'>
  permissions: (typeof PERMISSIONS)[number][]
}

export type RolePermissionRow = {
  role: (typeof ROLES)[number]
  permission: (typeof PERMISSIONS)[number]
  granted: boolean
}

export type AuditEntry = {
  id: number
  occurredAt: string
  actorId: string | null
  actorEmail: string | null
  action: string
  entityType: string
  entityId: string
  reason: string | null
  before: unknown
  after: unknown
}
