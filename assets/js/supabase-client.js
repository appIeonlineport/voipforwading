import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const SUPABASE_URL = 'https://jipmvlleiwgjgyskdciw.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_vXYqp4ysDOW3Q4Dlih7NtQ_cpPO335H';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export function isSupabaseConfigured() {
  return SUPABASE_PUBLISHABLE_KEY && !SUPABASE_PUBLISHABLE_KEY.includes('PASTE_');
}
