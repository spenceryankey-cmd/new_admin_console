import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common'
import { Pool, type PoolConfig } from 'pg'
import { ENV, type Env } from '../config/env'

/** The TLS settings for a connection. Railway's private network needs none; anything public must verify the server. */
export function sslFor(mode: Env['HETZNER_SSL'], ca?: string): PoolConfig['ssl'] {
  if (mode === 'disable') return false
  if (mode === 'no-verify') return { rejectUnauthorized: false }
  return ca ? { rejectUnauthorized: true, ca: ca.replace(/\\n/g, '\n') } : { rejectUnauthorized: true }
}

/**
 * Two separate connections to the hetzner database, with two separate database users:
 * a reader that cannot see secrets or change anything, and a writer that can only run the status
 * transition function. Credentials come from Railway variables and are never logged.
 */
@Injectable()
export class HetznerService implements OnModuleDestroy {
  private readonly log = new Logger('Hetzner')
  readonly read: Pool
  readonly write: Pool

  constructor(@Inject(ENV) env: Env) {
    const base = { ssl: sslFor(env.HETZNER_SSL, env.HETZNER_CA_CERT), connectionTimeoutMillis: 5_000, statement_timeout: 10_000, idleTimeoutMillis: 30_000 }
    this.read = new Pool({ ...base, connectionString: env.HETZNER_DATABASE_URL, max: 5 })
    this.write = new Pool({ ...base, connectionString: env.HETZNER_WRITE_DATABASE_URL, max: 2 })
    for (const p of [this.read, this.write]) p.on('error', (e) => this.log.warn(`Idle connection error: ${e.message}`))
  }

  async onModuleDestroy() {
    await Promise.all([this.read.end(), this.write.end()])
  }
}
