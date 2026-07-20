// Shared Supabase client (auth + sync + push). Sessions persist in
// localStorage and auto-refresh, so each device signs in once.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// `?? {}` keeps this module importable outside Vite (e.g. node test scripts).
const env = import.meta.env ?? {}
const SUPABASE_URL = env.VITE_SUPABASE_URL as string | undefined
const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY as string | undefined

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)
}

let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (!client) {
    if (!isSupabaseConfigured()) throw new Error('Supabase is not configured.')
    client = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!)
  }
  return client
}
