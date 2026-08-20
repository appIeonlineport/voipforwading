import { supabase } from './supabase-client.js';

function ensureStyles(){
  if(document.getElementById('nxHeaderCallStatsStyles')) return;
  const style=document.createElement('style');
  style.id='nxHeaderCallStatsStyles';
  style.textContent=`
    .nx-header-call-stats{display:flex;align-items:center;gap:18px;margin-left:auto;margin-right:4px}
    .nx-header-call-stat{display:flex;align-items:center;gap:9px;min-width:112px}
    .nx-header-call-stat svg{width:20px;height:20px;stroke-width:2.1}
    .nx-header-call-stat.live svg,.nx-header-call-stat.live strong{color:#12b76a}
    .nx-header-call-stat.completed svg,.nx-header-call-stat.completed strong{color:#4f63ff}
    .nx-header-call-stat strong{font-size:16px;line-height:1;font-weight:800}
    .nx-header-call-stat span{display:block;margin-top:3px;color:#667085;font-size:9px;font-weight:700;letter-spacing:.03em}
    @media(max-width:900px){.nx-header-call-stats{gap:10px}.nx-header-call-stat{min-width:auto}.nx-header-call-stat span{display:none}.nx-header-call-stat strong{font-size:14px}}
    @media(max-width:620px){.nx-header-call-stats{gap:8px;margin-left:auto}.nx-header-call-stat{gap:5px}.nx-header-call-stat svg{width:16px;height:16px}.nx-header-call-stat strong{font-size:12px}.top-actions .icon-btn{display:none}}
  `;
  document.head.appendChild(style);
}

function ensureHeader(){
  const top=document.querySelector('.topbar');
  const actions=document.querySelector('.top-actions');
  if(!top||!actions) return null;
  let wrap=document.getElementById('nxHeaderCallStats');
  if(wrap) return wrap;
  ensureStyles();
  wrap=document.createElement('div');
  wrap.id='nxHeaderCallStats';
  wrap.className='nx-header-call-stats';
  wrap.innerHTML=`
    <div class="nx-header-call-stat live" title="Current live calls">
      <i data-lucide="phone-call"></i>
      <div><strong id="nxHeaderLiveCalls">0</strong><span>LIVE CALLS</span></div>
    </div>
    <div class="nx-header-call-stat completed" title="Completed call records">
      <i data-lucide="phone"></i>
      <div><strong id="nxHeaderCompletedCalls">0</strong><span>COMPLETED</span></div>
    </div>`;
  actions.parentNode.insertBefore(wrap,actions);
  window.lucide?.createIcons?.();
  return wrap;
}

async function currentUser(){
  const {data}=await supabase.auth.getSession();
  return data?.session?.user||null;
}

async function refresh(){
  const user=await currentUser();
  if(!user) return;
  ensureHeader();
  const [liveRes,cdrRes]=await Promise.all([
    supabase.from('live_calls').select('id',{count:'exact',head:true}).eq('user_id',user.id),
    supabase.from('cdr').select('provider_call_id',{count:'exact',head:true}).eq('user_id',user.id)
  ]);
  if(!liveRes.error){
    const el=document.getElementById('nxHeaderLiveCalls');
    if(el) el.textContent=String(liveRes.count||0);
  }
  if(!cdrRes.error){
    const el=document.getElementById('nxHeaderCompletedCalls');
    if(el) el.textContent=String(cdrRes.count||0);
  }
}

if(/index\.html$|\/$/.test(location.pathname)){
  const start=()=>{
    ensureHeader();
    refresh().catch(console.error);
    setInterval(()=>refresh().catch(console.error),3000);
  };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
}
