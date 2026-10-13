import type { Role } from './access'

/**
 * Roles that must pass a second factor (an authenticator app code) before the console lets them do anything.
 * The API checks it on every route. Migration 0011 repeats the check for these roles in the database, so a
 * session that only passed the password step cannot read data straight through Supabase either.
 * To require it for another role, add the role here and to role_requires_mfa() in a new migration.
 * A test keeps the two lists equal.
 */
export const MFA_REQUIRED_ROLES = ['super_admin', 'decision_maker'] as const satisfies readonly Role[]

export function roleRequiresMfa(role: Role): boolean {
  return (MFA_REQUIRED_ROLES as readonly string[]).includes(role)
}

/** Supabase's authenticator assurance level: aal1 is password only, aal2 is password plus authenticator code. */
export type AssuranceLevel = 'aal1' | 'aal2'

export function isAssuranceLevel(v: unknown): v is AssuranceLevel {
  return v === 'aal1' || v === 'aal2'
}

export function mfaSatisfied(role: Role, aal: AssuranceLevel): boolean {
  return !roleRequiresMfa(role) || aal === 'aal2'
}

/** The error code the API sends when a required second factor is missing. The web app keys off it. */
export const MFA_REQUIRED_CODE = 'mfa_required'
export const MFA_REQUIRED_MESSAGE = 'Enter the code from your authenticator app to continue'

export type MfaStatus = { required: boolean; satisfied: boolean }
