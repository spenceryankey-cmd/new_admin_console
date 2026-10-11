import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const configError =
  !url || !anonKey || !import.meta.env.VITE_API_URL
    ? 'This console is not configured. Set VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY and VITE_API_URL.'
    : null

// Only the public anon key lives in the browser. All data access goes through
// the API, which checks the staff member's role on every request.
export const supabase = createClient(url || 'http://localhost', anonKey || 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})
