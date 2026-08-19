import { supabase } from './supabase-client.js';

let selectedUserId = null;

function ensurePasswordField(){
  const modal=document.getElementById('nxManageModal');
  if(!modal)return;
  const form=modal.querySelector('.form');
  if(!form||document.getElementById('nxManagePassword'))return;
  const field=document.createElement('div');
  field.className='field span2';
  field.innerHTML=`<label>New Password</label><div style="display:flex;gap:8px;align-items:center"><input id="nxManagePassword" type="password" minlength="8" autocomplete="new-password" placeholder="Minimum 8 characters" style="flex:1"><button type="button" class="btn" id="nxTogglePassword">Show</button><button type="button" class="btn" id="nxChangePassword">Change Password</button></div><div class="mini" style="margin-top:6px">Leave blank unless you want to reset this customer's login password.</div>`;
  form.appendChild(field);
  const input=document.getElementById('nxManagePassword');
  const toggle=document.getElementById('nxTogglePassword');
  toggle.onclick=()=>{const show=input.type==='password';input.type=show?'text':'password';toggle.textContent=show?'Hide':'Show'};
  document.getElementById('nxChangePassword').onclick=changePassword;
}

async function changePassword(){
  const msg=document.getElementById('nxManageMsg');
  const input=document.getElementById('nxManagePassword');
  const btn=document.getElementById('nxChangePassword');
  const password=input?.value||'';
  if(!selectedUserId){if(msg){msg.textContent='Select a customer first.';msg.style.color='#b42318'}return;}
  if(password.length<8){if(msg){msg.textContent='New password must be at least 8 characters.';msg.style.color='#b42318'}return;}
  btn.disabled=true;
  if(msg){msg.textContent='Changing password…';msg.style.color='#667085'}
  try{
    const {data:sessionData,error:sessionError}=await supabase.auth.getSession();
    if(sessionError)throw sessionError;
    const token=sessionData?.session?.access_token;
    if(!token)throw new Error('Admin session expired. Please sign in again.');
    const {data,error}=await supabase.functions.invoke('admin-reset-password',{
      headers:{Authorization:`Bearer ${token}`},
      body:{user_id:selectedUserId,password}
    });
    if(error){let detail='';try{if(error.context&&typeof error.context.json==='function'){const p=await error.context.json();detail=p?.error||p?.message||''}}catch{}throw new Error(detail||error.message||'Password update failed.');}
    if(!data?.success)throw new Error(data?.error||'Password update failed.');
    input.value='';
    if(msg){msg.textContent='Customer password changed successfully.';msg.style.color='#067647'}
  }catch(err){if(msg){msg.textContent=err?.message||'Password update failed.';msg.style.color='#b42318'}}
  finally{btn.disabled=false}
}

function captureManageClick(event){
  const btn=event.target.closest?.('.nx-manage-user');
  if(!btn)return;
  selectedUserId=btn.dataset.id||null;
  setTimeout(()=>{
    ensurePasswordField();
    const input=document.getElementById('nxManagePassword');
    if(input)input.value='';
  },0);
}

function boot(){
  if(!/admin\.html$/i.test(location.pathname))return;
  document.addEventListener('click',captureManageClick,true);
  const obs=new MutationObserver(()=>ensurePasswordField());
  obs.observe(document.body,{childList:true,subtree:true});
  ensurePasswordField();
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
