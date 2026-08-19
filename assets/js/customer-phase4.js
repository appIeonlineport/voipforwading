import { supabase } from './supabase-client.js';

const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
let state={profile:null,numbers:[],campaigns:[],campaignNumbers:[],destinations:[]};
let editingCampaign=null;

async function load(){
  const {data:{user}}=await supabase.auth.getUser();
  if(!user)return;
  const [p,n,c,cn,d]=await Promise.all([
    supabase.from('profiles').select('id,email,full_name,max_concurrent_calls,status').eq('id',user.id).single(),
    supabase.from('assigned_numbers').select('id,phone_number,provider,label,enabled,user_id').eq('user_id',user.id).order('created_at'),
    supabase.from('campaigns').select('*').eq('user_id',user.id).order('created_at',{ascending:false}),
    supabase.from('campaign_numbers').select('campaign_id,number_id'),
    supabase.from('forwarding_destinations').select('*').order('priority')
  ]);
  for(const r of [p,n,c,cn,d]) if(r.error) throw r.error;
  state={profile:p.data,numbers:n.data||[],campaigns:c.data||[],campaignNumbers:cn.data||[],destinations:d.data||[]};
  render();
}

function ensureModal(){
  if(document.getElementById('nxCampaignModal'))return;
  const m=document.createElement('div');m.className='modal';m.id='nxCampaignModal';
  m.innerHTML=`<div class="modal-box"><h3 id="nxCampaignTitle" style="margin-top:0">New Campaign</h3><div class="form-grid">
  <div class="field span2"><label>Campaign Name</label><input id="nxCampName" placeholder="Main Sales"></div>
  <div class="field"><label>Assigned TFN</label><select id="nxCampNumber"></select></div>
  <div class="field"><label>Routing Mode</label><select id="nxCampMode"><option value="first_available">First Available</option><option value="round_robin">Round Robin</option><option value="simultaneous">Simultaneous</option></select></div>
  <div class="field"><label>Max CC</label><input id="nxCampCc" type="number" min="1" value="1"></div>
  <div class="field"><label>Status</label><select id="nxCampEnabled"><option value="true">Enabled</option><option value="false">Disabled</option></select></div>
  <div class="field span2"><label>Forwarding Destination</label><input id="nxDestPhone" placeholder="+1..."></div>
  <div class="field"><label>Destination Label</label><input id="nxDestLabel" placeholder="Primary Agent"></div>
  <div class="field"><label>Priority</label><input id="nxDestPriority" type="number" min="1" value="1"></div>
  </div><p id="nxCampHint" class="mini"></p><div class="modal-actions"><button class="btn" id="nxCampCancel">Cancel</button><button class="btn primary" id="nxCampSave">Save Campaign</button></div><p id="nxCampMsg" class="mini"></p></div>`;
  document.body.appendChild(m);
  document.getElementById('nxCampCancel').onclick=()=>m.classList.remove('open');
  document.getElementById('nxCampSave').onclick=saveCampaign;
}

function openCampaign(c=null){
  ensureModal();editingCampaign=c;
  const assigned=state.numbers.filter(n=>n.enabled!==false);
  const sel=document.getElementById('nxCampNumber');
  sel.innerHTML=assigned.map(n=>`<option value="${esc(n.id)}">${esc(n.phone_number)}</option>`).join('')||'<option value="">No TFN assigned</option>';
  const link=c?state.campaignNumbers.find(x=>x.campaign_id===c.id):null;
  document.getElementById('nxCampaignTitle').textContent=c?'Manage Campaign':'New Campaign';
  document.getElementById('nxCampName').value=c?.name||'';
  document.getElementById('nxCampMode').value=c?.routing_mode||'first_available';
  document.getElementById('nxCampCc').value=c?.max_concurrent_calls||1;
  document.getElementById('nxCampEnabled').value=String(c?.enabled!==false);
  if(link)sel.value=link.number_id;
  const dest=c?state.destinations.find(x=>x.campaign_id===c.id):null;
  document.getElementById('nxDestPhone').value=dest?.phone_number||'';
  document.getElementById('nxDestLabel').value=dest?.label||'';
  document.getElementById('nxDestPriority').value=dest?.priority||1;
  document.getElementById('nxCampHint').textContent=`Account Max CC: ${state.profile?.max_concurrent_calls??0}. Campaign cannot exceed this limit.`;
  document.getElementById('nxCampMsg').textContent='';
  document.getElementById('nxCampaignModal').classList.add('open');
}

async function saveCampaign(){
  const msg=document.getElementById('nxCampMsg');msg.textContent='Saving...';
  try{
    const payload={p_campaign_id:editingCampaign?.id||null,p_name:document.getElementById('nxCampName').value.trim(),p_enabled:document.getElementById('nxCampEnabled').value==='true',p_routing_mode:document.getElementById('nxCampMode').value,p_max_concurrent_calls:Number(document.getElementById('nxCampCc').value||1),p_number_id:document.getElementById('nxCampNumber').value||null};
    const res=await supabase.rpc('customer_manage_campaign',payload);if(res.error)throw res.error;
    const campaign=Array.isArray(res.data)?res.data[0]:res.data;
    const phone=document.getElementById('nxDestPhone').value.trim();
    if(phone){
      const existing=editingCampaign?state.destinations.find(x=>x.campaign_id===editingCampaign.id):null;
      const dr=await supabase.rpc('customer_manage_destination',{p_destination_id:existing?.id||null,p_campaign_id:campaign.id,p_phone_number:phone,p_label:document.getElementById('nxDestLabel').value.trim()||null,p_priority:Number(document.getElementById('nxDestPriority').value||1),p_enabled:true});if(dr.error)throw dr.error;
    }
    msg.textContent='Campaign saved successfully.';msg.style.color='#067647';await load();setTimeout(()=>document.getElementById('nxCampaignModal').classList.remove('open'),400);
  }catch(e){msg.textContent=e?.message||'Campaign save failed.';msg.style.color='#b42318';}
}

function render(){
  const body=document.querySelector('#campaigns tbody');if(!body)return;
  const numberMap=new Map(state.numbers.map(n=>[n.id,n]));
  body.innerHTML=state.campaigns.map(c=>{const links=state.campaignNumbers.filter(x=>x.campaign_id===c.id);const dest=state.destinations.filter(x=>x.campaign_id===c.id);const tfns=links.map(x=>numberMap.get(x.number_id)?.phone_number).filter(Boolean).join(', ')||'—';return `<tr><td><strong>${esc(c.name)}</strong></td><td>${esc(tfns)}</td><td>${dest.length}</td><td>${esc(c.max_concurrent_calls)}</td><td>${esc(c.routing_mode)}</td><td><span class="badge ${c.enabled?'green':'amber'}">${c.enabled?'Active':'Disabled'}</span></td><td><button class="btn nx-edit-campaign" data-id="${esc(c.id)}">Manage</button></td></tr>`}).join('')||'<tr><td colspan="7">No campaigns configured.</td></tr>';
  body.querySelectorAll('.nx-edit-campaign').forEach(b=>b.onclick=()=>openCampaign(state.campaigns.find(c=>c.id===b.dataset.id)));
  document.querySelectorAll('[onclick="openCampaign()"],#campaigns .hero .btn.primary').forEach(b=>{b.onclick=(e)=>{e?.preventDefault();openCampaign(null)}});
  window.openCampaign=()=>openCampaign(null);
  const grid=document.querySelector('#numbers .panel-grid');if(grid){grid.innerHTML=state.numbers.map(n=>`<div class="did-card"><span class="badge ${n.enabled?'green':'amber'}">${n.enabled?'Active':'Disabled'}</span><div class="did-number">${esc(n.phone_number)}</div><div class="mini">${esc(n.provider||'Voice')} · Assigned by NX Voice</div></div>`).join('')||'<div class="did-card"><span class="badge blue">None assigned</span><div class="did-number">No TFN yet</div></div>'}
}

export async function setupCustomerPhase4(){ensureModal();await load();}
