/**
 * Field names that must never appear in anything the API sends to the browser, at any depth.
 * The Xpert identity record keeps only the last four digits of the ID and a hash, and the API's database user
 * cannot even read that table. This list is the second line of defence: a test calls every read route with sample
 * data and fails if any of these names turns up in a response. Compared without case, ignoring underscores and hyphens.
 */
export const NEVER_RETURNED_FIELDS = [
  // Identity records
  'idHash',
  'idNumber',
  'ghanaCardNumber',
  'idVerificationRef',
  'cardNumber',
  // Xpert PIN and sign in secrets
  'pin',
  'pinHash',
  'passwordHash',
  'password',
  // Tokens and keys
  'accessToken',
  'refreshToken',
  'serviceRoleKey',
  'apiKey',
  'secret',
  'otpSecret',
  'totpSecret',
  // Connection strings
  'databaseUrl',
  'hetznerDatabaseUrl',
  'hetznerWriteDatabaseUrl',
  // Left over from the prison and offense fields that were dropped in migration 0004
  'prisonFacility',
  'releaseDate',
  'offenseLevel',
  'offenseNotes',
] as const

const norm = (s: string) => s.toLowerCase().replace(/[_-]/g, '')
const BLOCKED = new Set(NEVER_RETURNED_FIELDS.map(norm))

/** Every path in a JSON value whose key is on the list. An empty result means the value is clean. */
export function findSensitiveKeys(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => findSensitiveKeys(v, `${path}[${i}]`))
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => [
      ...(BLOCKED.has(norm(k)) ? [`${path}.${k}`] : []),
      ...findSensitiveKeys(v, `${path}.${k}`),
    ])
  }
  return []
}
