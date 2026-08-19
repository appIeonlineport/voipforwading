import { supabase, isSupabaseConfigured } from './supabase-client.js';

export async function signIn(email,password){
  if(!isSupabaseConfigured())throw new Error('Supabase publishable key is not configured yet.');
  return supabase.auth.signInWithPassword({email,password});
}

export async function signOut(){
  if(isSupabaseConfigured())await supabase.auth.signOut();
  window.location.href='login.html';
}

export async function getVerifiedUser(){
  if(!isSupabaseConfigured())return null;
  const {data:sessionData,error:sessionError}=await supabase.auth.getSession();
  if(sessionError)return null;
  if(sessionData?.session?.user)return sessionData.session.user;
  const {data,error}=await supabase.auth.getUser();
  return error?null:(data.user||null);
}

export async function getProfile(userId){
  if(!isSupabaseConfigured()||!userId)return null;
  const {data,error}=await supabase.from('profiles').select('id,email,full_name,role,status,max_concurrent_calls').eq('id',userId).single();
  if(error)throw error;
  return data;
}

export async function requireRole(allowedRoles=['customer']){
  if(!isSupabaseConfigured())throw new Error('Supabase is not configured.');
  const user=await getVerifiedUser();
  if(!user){window.location.replace('login.html');return null;}
  const profile=await getProfile(user.id);
  if(!profile||profile.status!=='active'||!allowedRoles.includes(profile.role)){
    await supabase.auth.signOut();
    window.location.replace('login.html?error=unauthorized');
    return null;
  }
  return {user,profile,demo:false};
}

export async function loadCustomerSnapshot(userId){
  if(!isSupabaseConfigured())return null;
  const [wallet,campaigns,numbers,liveCalls,cdr]=await Promise.all([
    supabase.from('minute_wallets').select('*').eq('user_id',userId).maybeSingle(),
    supabase.from('campaigns').select('*').eq('user_id',userId).order('created_at',{ascending:false}),
    supabase.from('assigned_numbers').select('*').eq('user_id',userId).order('created_at',{ascending:false}),
    supabase.from('live_calls').select('*').eq('user_id',userId).order('started_at',{ascending:false}),
    supabase.from('cdr').select('*').eq('user_id',userId).order('created_at',{ascending:false}).limit(100)
  ]);
  for(const r of [wallet,campaigns,numbers,liveCalls,cdr])if(r.error)throw r.error;
  const ids=(campaigns.data||[]).map(c=>c.id);
  let campaignNumbers=[],destinations=[];
  if(ids.length){
    const [cn,fd]=await Promise.all([
      supabase.from('campaign_numbers').select('campaign_id,number_id,created_at').in('campaign_id',ids),
      supabase.from('forwarding_destinations').select('*').in('campaign_id',ids).order('priority',{ascending:true})
    ]);
    if(cn.error)throw cn.error;if(fd.error)throw fd.error;
    campaignNumbers=cn.data||[];destinations=fd.data||[];
  }
  return {wallet:wallet.data,campaigns:campaigns.data||[],numbers:numbers.data||[],campaignNumbers,destinations,liveCalls:liveCalls.data||[],cdr:cdr.data||[]};
}

async function setupAdminProvisioning(){
  if(!/admin\.html$/i.test(location.pathname))return;
  const button=document.getElementById('createUserBtn'),msg=document.getElementById('userMsg'),emailInput=document.getElementById('newEmail');
  if(!button||!msg||!emailInput)return;
  if(!document.getElementById('newFullName')){
    const emailField=emailInput.closest('.field');
    if(emailField?.parentElement){
      const field=document.createElement('div');field.className='field span2';
      field.innerHTML='<label>Customer / Company Name</label><input id="newFullName" type="text" placeholder="e.g. ABC Sales LLC">';
      emailField.parentElement.insertBefore(field,emailField);
    }
  }
  button.addEventListener('click',async event=>{
    event.preventDefault();event.stopImmediatePropagation();
    const fullName=document.getElementById('newFullName')?.value.trim()||'';
    const email=emailInput.value.trim(),password=document.getElementById('newPassword')?.value||'';
    const initialMinutes=Number(document.getElementById('newMinutes')?.value||0),maxCC=Number(document.getElementById('newCc')?.value||2);
    if(!fullName||!email||password.length<8){msg.textContent='Enter customer/company name, valid email and a password of at least 8 characters.';msg.style.color='#b42318';return;}
    button.disabled=true;button.textContent='Creating…';msg.textContent='Creating secure customer account…';msg.style.color='#667085';
    try{
      const {data:sessionData,error:sessionError}=await supabase.auth.getSession();if(sessionError)throw sessionError;
      const accessToken=sessionData?.session?.access_token;if(!accessToken)throw new Error('Admin session expired. Please sign in again.');
      const {data,error}=await supabase.functions.invoke('admin-create-user',{headers:{Authorization:`Bearer ${accessToken}`},body:{full_name:fullName,email,password,initial_minutes:initialMinutes,max_concurrent_calls:maxCC}});
      if(error){let detail='';try{if(error.context&&typeof error.context.json==='function'){const p=await error.context.json();detail=p?.error||p?.message||''}}catch{}throw new Error(detail||error.message||'Edge Function request failed.');}
      if(!data?.success)throw new Error(data?.error||'Customer account could not be created.');
      msg.textContent=`Customer created: ${data.user.email} · ${data.user.initial_minutes} minutes · Max CC ${data.user.max_concurrent_calls}`;msg.style.color='#067647';
      emailInput.value='';document.getElementById('newPassword').value='';document.getElementById('newFullName').value='';
      if(window.nxReloadAdmin)await window.nxReloadAdmin();
    }catch(error){msg.textContent=error?.message||'Customer creation failed.';msg.style.color='#b42318';}
    finally{button.disabled=false;button.textContent='Create Account';}
  },true);
}

async function bootAdmin(){
  if(!/admin\.html$/i.test(location.pathname))return;
  await setupAdminProvisioning();
  try{const mod=await import('./admin-phase3.js?v=202608190715');await mod.setupAdminPhase3();}catch(error){console.error('NX Admin controls failed',error);}
  import('./portal-live.js?v=202608190715').catch(error=>console.error('NX admin live module failed',error));
}

if(/index\.html$|\/$/.test(location.pathname)){
  import('./drawer-final.js?v=202608190715').catch(error=>console.error('NX customer runtime failed',error));
}

if(/index\.html$|\/$|admin\.html$/i.test(location.pathname)){
  import('./dashboard-analytics.js?v=202608192351').catch(error=>console.error('NX dashboard analytics failed',error));
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bootAdmin,{once:true});else bootAdmin();
