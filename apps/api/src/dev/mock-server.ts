// Development only. Runs the REAL controllers, guards and services against an in memory
// store, so the web app can be tried without Supabase. Nothing here is used in production.
//   npm run dev:mock -w @beyondx/api        (ROLE=ops_reviewer to try another role)
import 'reflect-metadata'
import { ROLES, isRole, type Role } from '@beyondx/shared'
import { buildMockApp } from './mock-app'

const roleEnv = process.env.ROLE ?? 'super_admin'
const role: Role = isRole(roleEnv) ? roleEnv : (ROLES[0] as Role)

async function main() {
  const app = await buildMockApp(role)
  app.enableCors({ origin: true })
  await app.listen(Number(process.env.PORT ?? 3998))
  console.log(`Mock API on ${process.env.PORT ?? 3998} as ${role}`)
}
void main()
