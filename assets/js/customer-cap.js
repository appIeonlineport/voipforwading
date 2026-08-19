import { supabase } from './supabase-client.js';

const $=(s,c=document)=>c.querySelector(s);
const $$=(s,c=document)=>[...c.querySelectorAll(s)];
const digits=v=>String(v||'').replace(/\D/g,'');
let editingCampaignId=null;
let loadedDestinations=[];

function isCustomerPage(){return /index\.html$|\/$/.test(location.pathname)}

function ensureMobileStyle(){
  if($('#nxCustomerCapStyle'))return;
  const style=document.createElement('style');
  style.id='nxCustomerCapStyle';
  style.textContent=`
    .nx-destination-row.nx-cap-ready{grid-template-columns:minmax(130px,1.25fr) minmax(95px,.9fr) 70px 78px 78px 40px!important}
    @media(max-width:760px){
      .nx-destination-row.nx-cap-ready{grid-template-columns:1fr 1fr!important;padding:10px 0;border-bottom:1px solid #eef1f4}
      .nx-destination-row.nx-cap-ready .nx-remove-dest{grid-column:2}
    }
  `;
  document.head.appendChild(style);
}

function ensureCampaignCap(){
  const box=$('#campaignModal .modal-box');
  const cc=$('#nxCampaignCc',box);
  if(!box||!cc)return;
  const routing=$('#nxCampaignRouting',box);
  const sim=routing?.querySelector('option[value="simultaneous"]');
  sim?.remove();
  if(!$('#nxCampaignCap',box)){
    const f=document.createElement('div');
    f.className='field';
    f.innerHTML='<label>Campaign CAP</label><input id="nxCampaignCap" type="number" min="1" inputmode="numeric" placeholder="Unlimited"><div class="mini">Total connected calls allowed. Blank = unlimited.</div>';
    cc.closest('.field')?.after(f);
  }
}

function destinationForRow(row){
  const phone=digits($('.nx-dest-phone',row)?.value);
  return loadedDestinations.find(d=>digits(d.phone_number)===phone)||null;
}

function enhanceDestinationRow(row){
  if(!row||row.classList.contains('nx-cap-ready'))return;
  row.classList.add('nx-cap-ready');
  const remove=$('.nx-remove-dest',row);
  const d=destinationForRow(row);
  const cc=document.createElement('div');
  cc.innerHTML=`<label class="mini">Agent CC</label><input class="nx-dest-cc" type="number" min="1" inputmode="numeric" value="${Number(d?.max_concurrent_calls||1)}">`;
  const cap=document.createElement('div');
  cap.innerHTML=`<label class="mini">Agent CAP</label><input class="nx-dest-cap" type="number" min="1" inputmode="numeric" placeholder="∞" value="${d?.call_cap??''}">`;
  remove?.before(cc);remove?.before(cap);
}

function enhanceAllRows(){
  ensureCampaignCap();
  $$('.nx-destination-row').forEach(enhanceDestinationRow);
}

async function prepareModal(){
  ensureMobileStyle();
  loadedDestinations=[];
  if(editingCampaignId){
    const [cRes,dRes]=await Promise.all([
      supabase.from('campaigns').select('id,call_cap,routing_mode').eq('id',editingCampaignId).maybeSingle(),
      supabase.from('forwarding_destinations').select('id,phone_number,max_concurrent_calls,call_cap').eq('campaign_id',editingCampaignId).order('priority')
    ]);
    if(!cRes.error){
      ensureCampaignCap();
      const cap=$('#nxCampaignCap');if(cap)cap.value=cRes.data?.call_cap??'';
      const routing=$('#nxCampaignRouting');if(routing&&cRes.data?.routing_mode!=='simultaneous')routing.value=cRes.data?.routing_mode||'first_available';
    }
    if(!dRes.error)loadedDestinations=dRes.data||[];
  }
  enhanceAllRows();
  const msg=$('#nxCampaignMsg');
  if(msg)msg.textContent=(msg.textContent?msg.textContent+' · ':'')+'CC = simultaneous live calls; CAP = total connected calls.';
}

function collectDestinations(){
  return $$('.nx-destination-row').map((row,i)=>({
    phone_number:$('.nx-dest-phone',row)?.value.trim()||'',
    label:$('.nx-dest-label',row)?.value.trim()||'',
    priority:Number($('.nx-dest-priority',row)?.value||i+1),
    enabled:true,
    max_concurrent_calls:Number($('.nx-dest-cc',row)?.value||1),
    call_cap:$('.nx-dest-cap',row)?.value?Number($('.nx-dest-cap',row).value):null
  })).filter(d=>d.phone_number);
}

async function saveCampaign(){
  const btn=$('#nxCampaignSave'),msg=$('#nxCampaignMsg');
  if(!btn)return;
  btn.disabled=true;
  if(msg){msg.style.color='#667085';msg.textContent='Saving campaign routing…'}
  try{
    const name=$('#nxCampaignName')?.value.trim()||'';
    const routing=$('#nxCampaignRouting')?.value||'first_available';
    const campaignCc=Number($('#nxCampaignCc')?.value||1);
    const campaignCap=$('#nxCampaignCap')?.value?Number($('#nxCampaignCap').value):null;
    const numberIds=[...($('#nxCampaignTfns')?.selectedOptions||[])].map(o=>o.value).filter(Boolean);
    const destinations=collectDestinations();
    if(!name)throw new Error('Campaign name is required.');
    if(!numberIds.length)throw new Error('Select at least one assigned TFN.');
    if(!destinations.length)throw new Error('Add at least one forwarding destination.');
    if(destinations.some(d=>d.max_concurrent_calls>campaignCc))throw new Error('Agent CC cannot exceed Campaign CC.');
    const {error}=await supabase.rpc('customer_save_campaign',{
      p_campaign_id:editingCampaignId,
      p_name:name,
      p_routing_mode:routing,
      p_max_concurrent_calls:campaignCc,
      p_enabled:$('#nxCampaignEnabled')?.value==='true',
      p_number_ids:numberIds,
      p_destinations:destinations,
      p_call_cap:campaignCap
    });
    if(error)throw error;
    if(msg){msg.style.color='#067647';msg.textContent='Campaign saved successfully.'}
    setTimeout(()=>location.reload(),250);
  }catch(e){
    if(msg){msg.style.color='#b42318';msg.textContent=e?.message||'Campaign save failed.'}
    btn.disabled=false;
  }
}

function boot(){
  if(!isCustomerPage())return;
  ensureMobileStyle();
  document.addEventListener('click',e=>{
    const manage=e.target.closest('.nx-edit-campaign');
    const newBtn=e.target.closest('#campaigns .btn.primary,.top-actions .btn.soft');
    if(manage){editingCampaignId=manage.dataset.id||null;setTimeout(()=>prepareModal().catch(console.error),0);return;}
    if(newBtn){editingCampaignId=null;loadedDestinations=[];setTimeout(()=>prepareModal().catch(console.error),0);return;}
    if(e.target.closest('#nxAddDestination'))setTimeout(enhanceAllRows,0);
  },true);
  document.addEventListener('click',e=>{
    if(!e.target.closest('#nxCampaignSave'))return;
    e.preventDefault();e.stopImmediatePropagation();e.stopPropagation();
    saveCampaign();
  },true);
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
