import { supabase } from './supabase-client.js';

const $=(s,c=document)=>c.querySelector(s), $$=(s,c=document)=>[...c.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const fmtMin=s=>{const n=Math.max(0,Number(s||0))/60;return Number.isInteger(n)?String(n):n.toFixed(1)};
const liveStatuses=['ringing','answered','connected','in_progress'];
let editingCampaignId=null;
let profile=null;

async function sessionProfile(){
  const {data:{user}}=await supabase.auth.getUser();
  if(!user)return null;
  const {data}=await supabase.from('profiles').select('id,email,role,status,max_concurrent_calls').eq('id',user.id).maybeSingle();
  return data||null;
}

function replaceDemoText(){
  $$('[data-demo-action]').forEach(b=>{
    b.removeAttribute('data-demo-action');
    if(/notifications/i.test(b.getAttribute('aria-label')||b.textContent||''))return;
    b.title='This module is not live yet';
  });
}

async function cleanupCustomer(){
  if(!/index\.html$|\/$/.test(location.pathname)||profile?.role!=='customer')return;
  replaceDemoText();
  const uid=profile.id;
  const [cdrRes,liveRes,campRes,destRes]=await Promise.all([
    supabase.from('cdr').select('*').eq('user_id',uid).order('created_at',{ascending:false}).limit(500),
    supabase.from('live_calls').select('*').eq('user_id',uid),
    supabase.from('campaigns').select('*').eq('user_id',uid).order('created_at',{ascending:false}),
    supabase.from('forwarding_destinations').select('*').in('campaign_id',(await supabase.from('campaigns').select('id').eq('user_id',uid)).data?.map(x=>x.id)||[])
  ]);
  const cdr=cdrRes.data||[], live=liveRes.data||[], campaigns=campRes.data||[], dests=destRes.data||[];

  const reportStats=$$('#reports .grid4 .stat');
  const answered=cdr.filter(x=>String(x.final_status||'').toLowerCase()==='answered'||Number(x.connected_seconds||0)>0);
  if(reportStats[0])reportStats[0].querySelector('strong').textContent=String(cdr.length);
  if(reportStats[1])reportStats[1].querySelector('strong').textContent=String(answered.length);
  if(reportStats[2]){
    const avg=answered.length?Math.round(answered.reduce((a,x)=>a+Number(x.connected_seconds||0),0)/answered.length):0;
    reportStats[2].querySelector('strong').textContent=`${Math.floor(avg/60)}m ${avg%60}s`;
  }
  if(reportStats[3])reportStats[3].querySelector('strong').textContent=String(live.length);
  const reportChart=$('#reports .chart'); if(reportChart)reportChart.innerHTML='<div class="mini" style="margin:auto">Live reporting will populate from real CDR as calls are processed.</div>';
  const loadCard=$('#reports .layout .card:nth-child(2)');
  if(loadCard){
    const rows=dests.map(d=>`<div class="quick-item"><div><strong>${esc(d.label||d.phone_number)}</strong><span>Completed ${Number(d.completed_calls||0)}${d.call_cap?` / CAP ${d.call_cap}`:' · No CAP'}</span></div></div>`).join('');
    const q=loadCard.querySelector('.quick'); if(q)q.innerHTML=rows||'<div class="mini">No forwarding destinations configured.</div>';
  }
  const dl=$('#reports .hero .btn'); if(dl){dl.disabled=true;dl.textContent='Export coming soon'};
  const req=$('#numbers .hero .btn'); if(req){req.disabled=true;req.textContent='TFN assigned by admin'};
  $$('#support .btn').forEach(b=>{b.disabled=true;b.textContent='Coming soon'});
  const settingsSave=$('#settings .hero .btn'); if(settingsSave){settingsSave.disabled=true;settingsSave.textContent='Settings backend pending'};

  const obs=new MutationObserver(()=>upgradeCampaignModal(campaigns));
  obs.observe(document.body,{childList:true,subtree:true});
  upgradeCampaignModal(campaigns);
  document.addEventListener('click',e=>{
    const manage=e.target.closest('.nx-edit-campaign'); if(manage)editingCampaignId=manage.dataset.id||null;
    const newBtn=e.target.closest('#campaigns .btn.primary,.top-actions .btn.soft'); if(newBtn&&!manage)editingCampaignId=null;
  },true);
}

function upgradeCampaignModal(campaigns=[]){
  const box=$('#campaignModal .modal-box'); if(!box||!$('#nxCampaignSave',box))return;
  const form=$('.form-grid',box); if(!form)return;
  if(!$('#nxCampaignCap',box)){
    const cc=$('#nxCampaignCc',box)?.closest('.field');
    const field=document.createElement('div'); field.className='field';
    field.innerHTML='<label>Campaign CAP (total connected calls)</label><input id="nxCampaignCap" type="number" min="1" placeholder="e.g. 10"><div class="mini">Blank = unlimited. CAP counts connected/completed calls.</div>';
    cc?.after(field);
  }
  const c=campaigns.find(x=>x.id===editingCampaignId);
  const cap=$('#nxCampaignCap',box); if(cap&&document.activeElement!==cap)cap.value=c?.call_cap??'';
  $$('.nx-destination-row',box).forEach(row=>upgradeDestinationRow(row));
  const save=$('#nxCampaignSave',box);
  if(save.dataset.capBound!=='1'){
    save.dataset.capBound='1';
    save.addEventListener('click',saveCampaignCap,true);
  }
  const msg=$('#nxCampaignMsg',box);
  if(msg&&profile)msg.textContent=`Account CC limit: ${profile.max_concurrent_calls}. CC = simultaneous live calls; CAP = total connected calls.`;
}

function upgradeDestinationRow(row){
  if(row.dataset.capReady==='1')return; row.dataset.capReady='1';
  row.style.gridTemplateColumns='1.15fr .9fr 62px 72px 72px 40px';
  const remove=$('.nx-remove-dest',row);
  const cc=document.createElement('div'); cc.innerHTML='<label class="mini">Agent CC</label><input class="nx-dest-cc" type="number" min="1" value="1">';
  const cap=document.createElement('div'); cap.innerHTML='<label class="mini">CAP</label><input class="nx-dest-cap" type="number" min="1" placeholder="∞">';
  remove?.before(cc); remove?.before(cap);
  const style=document.createElement('style');
  if(!$('#nxCapMobileStyle')){style.id='nxCapMobileStyle';style.textContent='@media(max-width:760px){.nx-destination-row{grid-template-columns:1fr 1fr!important}.nx-destination-row .nx-remove-dest{grid-column:2}}';document.head.appendChild(style)}
}

async function saveCampaignCap(e){
  e.preventDefault();e.stopImmediatePropagation();
  const save=$('#nxCampaignSave'),msg=$('#nxCampaignMsg');
  try{
    save.disabled=true; msg.textContent='Saving CC / CAP routing…';
    const numberIds=[...$('#nxCampaignTfns').selectedOptions].map(o=>o.value).filter(Boolean);
    const destinations=$$('.nx-destination-row').map((row,i)=>({
      phone_number:$('.nx-dest-phone',row)?.value.trim()||'',
      label:$('.nx-dest-label',row)?.value.trim()||'',
      priority:Number($('.nx-dest-priority',row)?.value||i+1),
      enabled:true,
      max_concurrent_calls:Number($('.nx-dest-cc',row)?.value||1),
      call_cap:$('.nx-dest-cap',row)?.value?Number($('.nx-dest-cap',row).value):null
    })).filter(x=>x.phone_number);
    const payload={
      p_campaign_id:editingCampaignId,
      p_name:$('#nxCampaignName').value.trim(),
      p_routing_mode:$('#nxCampaignRouting').value,
      p_max_concurrent_calls:Number($('#nxCampaignCc').value||1),
      p_enabled:$('#nxCampaignEnabled').value==='true',
      p_number_ids:numberIds,
      p_destinations:destinations,
      p_call_cap:$('#nxCampaignCap').value?Number($('#nxCampaignCap').value):null
    };
    const {error}=await supabase.rpc('customer_save_campaign',payload); if(error)throw error;
    msg.textContent='Campaign CC / CAP saved successfully.';msg.style.color='#067647';
    setTimeout(()=>location.reload(),350);
  }catch(err){msg.textContent=err?.message||'Save failed';msg.style.color='#b42318'}finally{save.disabled=false}
}

async function cleanupAdmin(){
  if(!/admin\.html$/i.test(location.pathname)||profile?.role!=='admin')return;
  replaceDemoText();
  const [profilesRes,campRes,cnRes,destRes,liveRes,cdrRes,walletRes]=await Promise.all([
    supabase.from('profiles').select('id,email,full_name').eq('role','customer'),
    supabase.from('campaigns').select('*').order('created_at',{ascending:false}),
    supabase.from('campaign_numbers').select('*'),
    supabase.from('forwarding_destinations').select('*').order('priority'),
    supabase.from('live_calls').select('*').order('started_at',{ascending:false}),
    supabase.from('cdr').select('*').order('created_at',{ascending:false}).limit(250),
    supabase.from('minute_wallets').select('*')
  ]);
  const profiles=profilesRes.data||[], campaigns=campRes.data||[], cn=cnRes.data||[], dests=destRes.data||[], live=liveRes.data||[], cdr=cdrRes.data||[], wallets=walletRes.data||[];
  const pmap=new Map(profiles.map(p=>[p.id,p]));
  const cb=$('#campaigns tbody'); if(cb)cb.innerHTML=campaigns.map(c=>`<tr><td><strong>${esc(c.name)}</strong><br><span class="mini">CAP ${c.completed_calls||0}${c.call_cap?` / ${c.call_cap}`:' / ∞'}</span></td><td>${esc(pmap.get(c.user_id)?.email||'—')}</td><td>${cn.filter(x=>x.campaign_id===c.id).length}</td><td>${dests.filter(x=>x.campaign_id===c.id).length}</td><td>${live.filter(x=>x.campaign_id===c.id&&liveStatuses.includes(x.status)).length} / ${c.max_concurrent_calls}</td><td>${esc(String(c.routing_mode).replaceAll('_',' '))}</td><td><span class="badge ${c.enabled?'green':'amber'}">${c.enabled?'Active':'Paused'}</span></td></tr>`).join('')||'<tr><td colspan="7">No campaigns configured.</td></tr>';
  const lb=$('#live tbody'); if(lb)lb.innerHTML=live.map(x=>`<tr><td>${esc(pmap.get(x.user_id)?.email||'—')}</td><td>${esc(x.caller_number||'—')}</td><td>${esc(x.dialed_number||'—')}</td><td>${esc(x.forwarded_to||'—')}</td><td>${esc(x.status)}</td><td>Live</td></tr>`).join('')||'<tr><td colspan="6">No live calls.</td></tr>';
  const cd=$('#cdr tbody'); if(cd)cd.innerHTML=cdr.map(x=>`<tr><td>${esc(new Date(x.created_at).toLocaleString())}</td><td>${esc(pmap.get(x.user_id)?.email||'—')}</td><td>${esc(x.caller_number||'—')}</td><td>${esc(x.dialed_number||'—')}</td><td>${esc(x.forwarded_to||'—')}</td><td>${esc(x.final_status||'—')}</td><td>${fmtMin(x.billed_seconds)}m</td></tr>`).join('')||'<tr><td colspan="7">No CDR records yet.</td></tr>';
  const minCard=$('#minutes .card'); if(minCard)minCard.innerHTML='<h3>Customer Minute Buckets</h3>'+wallets.map(w=>`<div class="health-row"><span>${esc(pmap.get(w.user_id)?.email||w.user_id)}</span><strong>${fmtMin(w.remaining_seconds)} min</strong></div>`).join('');
  const overviewSpans=$$('#overview .stat span:last-child'); if(overviewSpans[0])overviewSpans[0].textContent='Live customer profiles';
  const serviceRows=$$('#overview .layout .card:nth-child(2) .health-row');
  if(serviceRows[2])serviceRows[2].innerHTML='<span>CDR Processor</span><span class="badge amber">Awaiting SignalWire webhook</span>';
  if(serviceRows[3])serviceRows[3].innerHTML='<span>Minute Engine</span><span class="badge green">Database ready</span>';
  const pay=$('#payments .card p');if(pay)pay.textContent='No payment module is connected yet. No demo transactions are shown.';
  const audit=$('#audit .card p');if(audit)audit.textContent='Audit persistence is not connected yet. No demo audit events are shown.';
}

async function boot(){
  try{profile=await sessionProfile();if(!profile)return;await cleanupCustomer();await cleanupAdmin()}catch(e){console.error('NX live cleanup error',e)}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,350),{once:true});else setTimeout(boot,350);
