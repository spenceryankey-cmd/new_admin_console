import { z } from 'zod'

// Table and column names are put into queries, so only plain identifiers are accepted.
const ident = z.string().regex(/^[a-z_][a-z0-9_]*$/, 'must be a plain lowercase identifier')
const identList = z.string().regex(/^[a-z_][a-z0-9_]*(,[a-z_][a-z0-9_]*)*$/, 'must be identifiers separated by commas')
// Empty variables count as unset.
const blankToUndefined = (env: NodeJS.ProcessEnv) =>
  Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ''))

const schema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  WEB_APP_URL: z.string().url(),
  CORS_ORIGINS: z.string().default(''),
  PORT: z.coerce.number().int().positive().default(3000),
  // Where the existing Xpert records live. XPERT_TABLE has no default on purpose: it must be confirmed from the schema export. The others are ASSUMED until the schema
  // export confirms them. Column lists may name several columns joined by commas
  // (for example first_name,last_name). Identifiers only, checked below.
  XPERT_TABLE: ident,
  XPERT_ID_COLUMN: ident.default('id'),
  XPERT_NAME_COLUMNS: identList.default('full_name'),
  XPERT_PHONE_COLUMN: ident.default('phone'),
  XPERT_AREA_COLUMN: ident.optional(),
  XPERT_SKILLS_COLUMN: ident.optional(),
  XPERT_CREATED_COLUMN: ident.default('created_at'),
  // Optional: where a new applicant's guarantor is stored on the Xpert record.
  // When set, the sweep copies it into the guarantor table.
  XPERT_GUARANTOR_NAME_COLUMN: ident.optional(),
  XPERT_GUARANTOR_CONTACT_COLUMN: ident.optional(),
  XPERT_GUARANTOR_RELATIONSHIP_COLUMN: ident.optional(),
  // Set to false to stop the hourly background sweep (it can still be run by hand).
  SWEEPS_ENABLED: z.enum(['true', 'false']).default('true'),
})

export type Env = z.infer<typeof schema>

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(blankToUndefined(source))
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`Invalid environment. ${problems}. See .env.example.`)
  }
  return parsed.data
}

export const ENV = Symbol('ENV')
