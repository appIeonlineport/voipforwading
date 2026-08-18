import { supabase, isSupabaseConfigured } from './supabase-client.js';

export async function signIn(email, password) {
  if (!isSupabaseConfigured()) throw new Error('Supabase publishable key is not configured yet.');
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  if (!isSupabaseConfigured()) return;
  await supabase.auth.signOut();
  window.location.href = 'login.html';
}

export async function getVerifiedUser() {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user || null;
}

export async function getProfile(userId) {
  if (!isSupabaseConfigured() || !userId) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('id,email,full_name,role,status,max_concurrent_calls')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data;
}

export async function requireRole(allowedRoles = ['customer']) {
  if (!isSupabaseConfigured()) {
    console.warn('NX Voice Phase 2: Supabase key pending; auth guard is in demo bypass mode.');
    return { demo: true, profile: null };
  }

  const user = await getVerifiedUser();
  if (!user) {
    window.location.replace('login.html');
    return null;
  }

  const profile = await getProfile(user.id);
  if (!profile || profile.status !== 'active' || !allowedRoles.includes(profile.role)) {
    await supabase.auth.signOut();
    window.location.replace('login.html?error=unauthorized');
    return null;
  }
  return { user, profile, demo: false };
}

export async function loadCustomerSnapshot(userId) {
  if (!isSupabaseConfigured()) return null;
  const [wallet, campaigns, numbers, liveCalls, cdr] = await Promise.all([
    supabase.from('minute_wallets').select('*').eq('user_id', userId).maybeSingle(),
    supabase.from('campaigns').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
    supabase.from('assigned_numbers').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
    supabase.from('live_calls').select('*').eq('user_id', userId).order('started_at', { ascending: false }),
    supabase.from('cdr').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(100),
  ]);
  return {
    wallet: wallet.data,
    campaigns: campaigns.data || [],
    numbers: numbers.data || [],
    liveCalls: liveCalls.data || [],
    cdr: cdr.data || [],
  };
}
