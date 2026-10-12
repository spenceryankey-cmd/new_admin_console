import { z } from 'zod'

// Empty variables count as unset.
const blankToUndefined = (env: NodeJS.ProcessEnv) =>
  Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ''))

const schema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  WEB_APP_URL: z.string().url(),
  CORS_ORIGINS: z.string().default(''),
  PORT: z.coerce.number().int().positive().default(3000),
  // The hetzner Postgres database holds the Xpert records. Two connections with two database users:
  // a reader (cannot see secrets, cannot change anything) and a writer (can only run the status
  // transition function). Put both only in Railway variables, never in chat, GitHub or email.
  HETZNER_DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgres connection string'),
  HETZNER_WRITE_DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgres connection string'),
  // require: encrypted and the server certificate is checked (use for any public address).
  // disable: no encryption (only for Railway's private network inside one project).
  // no-verify: encrypted but the certificate is not checked. Weaker. Avoid.
  HETZNER_SSL: z.enum(['require', 'disable', 'no-verify']).default('require'),
  // Optional: the PEM of the certificate authority that signed the database certificate.
  HETZNER_CA_CERT: z.string().optional(),
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
