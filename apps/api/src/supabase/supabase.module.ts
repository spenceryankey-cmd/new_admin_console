import { Global, Module } from '@nestjs/common'
import { ENV, loadEnv } from '../config/env'
import { SupabaseService } from './supabase.service'

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => loadEnv() }, SupabaseService],
  exports: [ENV, SupabaseService],
})
export class SupabaseModule {}
