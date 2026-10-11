import { Inject, Injectable } from '@nestjs/common'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ENV, type Env } from '../config/env'

/**
 * Service role client. It bypasses RLS, so it must only be used from the API and
 * every caller must have passed the permission guards first.
 */
@Injectable()
export class SupabaseService {
  readonly admin: SupabaseClient

  constructor(@Inject(ENV) env: Env) {
    this.admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
}
