import { supabase } from './supabase-client.js';

const $=(s,c=document)=>c.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const isAnswered=r=>Number(r?.connected_seconds||0)>0 || ['answered','connected'].includes(String(r?.final_status||'').toLowerCase());

function ensureStyles(){
  if(document.getElementById('nxAnalyticsStyles'))return;
  const s=document.createElement('style');
  s.id='nxAnalyticsStyles';
  s.textContent=`
    .nx-call-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:16px 0}
    .nx-call-metric{background:#fff;border:1px solid #e4e7ec;border-radius:15px;padding:16px;display:flex;align-items:center;gap:12px;box-shadow:0 8px 24px rgba(16,24,40,.045)}
    .nx-call-icon{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;background:#f3f5fb;color:#475467;flex:0 0 auto}
    .nx-call-icon svg{width:19px;height:19px}.nx-call-metric small{display:block;color:#667085;font-size:10px;margin-bottom:3px}.nx-call-metric strong{font-size:24px;line-height:1}.nx-call-metric span{display:block;color:#98a2b3;font-size:9px;margin-top:5px}
    .nx-analytics-card{background:#fff;border:1px solid #e4e7ec;border-radius:15px;margin:16px 0;padding:18px;box-shadow:0 8px 24px rgba(16,24,40,.045)}
    .nx-analytics-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px}.nx-analytics-head h3{margin:0;font-size:13px}.nx-analytics-head p{margin:4px 0 0;color:#667085;font-size:10px}.nx-chart-legend{display:flex;gap:12px;font-size:9px;color:#667085;white-space:nowrap}.nx-chart-legend i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px;vertical-align:-1px}.nx-chart-legend .a i{background:#12b76a}.nx-chart-legend .m i{background:#f79009}
    .nx-svg-wrap{width:100%;overflow:hidden}.nx-svg-wrap svg{display:block;width:100%;height:auto;min-height:190px}.nx-axis-label{font-size:9px;fill:#98a2b3}.nx-gridline{stroke:#eef1f4;stroke-width:1}.nx-bar-answered{fill:#12b76a}.nx-bar-missed{fill:#f79009}.nx-empty-note{text-align:center;color:#98a2b3;font-size:10px;margin-top:6px}
    @media(max-width:760px){.nx-call-summary{grid-template-columns:1fr 1fr 1fr;gap:8px}.nx-call-metric{padding:12px 9px;display:block}.nx-call-icon{width:32px;height:32px;margin-bottom:8px}.nx-call-metric strong{font-size:20px}.nx-call-metric span{display:none}.nx-analytics-head{display:block}.nx-chart-legend{margin-top:8px}.nx-analytics-card{padding:14px}.nx-svg-wrap svg{min-height:170px}}
  `;
  document.head.appendChild(s);
}

function dayKey(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function dayLabel(d){return d.toLocaleDateString([], {weekday:'short'}).slice(0,3)}

function buildSeries(cdr){
  const days=[];
  const now=new Date();
  for(let i=6;i>=0;i--){const d=new Date(now);d.setHours(0,0,0,0);d.setDate(d.getDate()-i);days.push({key:dayKey(d),label:dayLabel(d),answered:0,missed:0});}
  const map=new Map(days.map(x=>[x.key,x]));
  for(const r of cdr){
    const raw=r.started_at||r.created_at;if(!raw)continue;
    const d=new Date(raw);if(Number.isNaN(d.getTime()))continue;
    const row=map.get(dayKey(d));if(!row)continue;
    if(isAnswered(r))row.answered++;else row.missed++;
  }
  return days;
}

function renderSvg(series){
  const W=760,H=210,left=34,right=12,top=12,bottom=34;
  const innerW=W-left-right,innerH=H-top-bottom;
  const max=Math.max(1,...series.map(d=>d.answered+d.missed));
  const groupW=innerW/series.length,barW=Math.min(22,groupW*.24),gap=4;
  let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Answered and missed calls over the last seven days">`;
  for(let i=0;i<=4;i++){
    const y=top+innerH*(i/4);const val=Math.round(max*(1-i/4));
    svg+=`<line class="nx-gridline" x1="${left}" x2="${W-right}" y1="${y}" y2="${y}"/><text class="nx-axis-label" x="${left-7}" y="${y+3}" text-anchor="end">${val}</text>`;
  }
  series.forEach((d,i)=>{
    const cx=left+groupW*i+groupW/2;
    const ah=(d.answered/max)*innerH,mh=(d.missed/max)*innerH;
    const ax=cx-barW-gap/2,mx=cx+gap/2;
    svg+=`<rect class="nx-bar-answered" x="${ax}" y="${top+innerH-ah}" width="${barW}" height="${ah}" rx="4"><title>${esc(d.label)} Answered: ${d.answered}</title></rect>`;
    svg+=`<rect class="nx-bar-missed" x="${mx}" y="${top+innerH-mh}" width="${barW}" height="${mh}" rx="4"><title>${esc(d.label)} Missed: ${d.missed}</title></rect>`;
    svg+=`<text class="nx-axis-label" x="${cx}" y="${H-10}" text-anchor="middle">${esc(d.label)}</text>`;
  });
  return svg+'</svg>';
}

function inject(target,cdr,live){
  if(!target)return;
  ensureStyles();
  const answered=cdr.filter(isAnswered).length;
  const missed=Math.max(0,cdr.length-answered);
  let summary=$('.nx-call-summary',target);
  if(!summary){
    summary=document.createElement('div');summary.className='nx-call-summary';
    const grid=$('.grid4',target);(grid||target.firstElementChild)?.insertAdjacentElement('afterend',summary);
  }
  summary.innerHTML=`
    <div class="nx-call-metric"><div class="nx-call-icon"><i data-lucide="phone-call"></i></div><div><small>Answered</small><strong>${answered}</strong><span>Connected calls</span></div></div>
    <div class="nx-call-metric"><div class="nx-call-icon"><i data-lucide="phone-missed"></i></div><div><small>Missed</small><strong>${missed}</strong><span>Busy, no-answer & failed</span></div></div>
    <div class="nx-call-metric"><div class="nx-call-icon"><i data-lucide="radio"></i></div><div><small>Live</small><strong>${live.length}</strong><span>Active right now</span></div></div>`;

  let card=$('.nx-analytics-card',target);
  if(!card){card=document.createElement('div');card.className='nx-analytics-card';summary.insertAdjacentElement('afterend',card);}
  const series=buildSeries(cdr);
  const total7=series.reduce((a,d)=>a+d.answered+d.missed,0);
  card.innerHTML=`<div class="nx-analytics-head"><div><h3>Call Analytics</h3><p>Answered vs missed call trend · Last 7 days</p></div><div class="nx-chart-legend"><span class="a"><i></i>Answered</span><span class="m"><i></i>Missed</span></div></div><div class="nx-svg-wrap">${renderSvg(series)}</div>${total7?'':`<div class="nx-empty-note">No completed call records yet — graph will update automatically when CDR arrives.</div>`}`;
  window.lucide?.createIcons?.();
}

async function boot(){
  const isAdmin=/admin\.html$/i.test(location.pathname);
  const isCustomer=/index\.html$|\/$/.test(location.pathname);
  if(!isAdmin&&!isCustomer)return;
  try{
    const {data:{user}}=await supabase.auth.getUser();if(!user)return;
    const {data:profile}=await supabase.from('profiles').select('id,role').eq('id',user.id).maybeSingle();if(!profile)return;
    if(isAdmin&&profile.role==='admin'){
      const [cdrRes,liveRes]=await Promise.all([
        supabase.from('cdr').select('created_at,started_at,final_status,connected_seconds').order('created_at',{ascending:false}).limit(500),
        supabase.from('live_calls').select('id,status').limit(500)
      ]);
      if(cdrRes.error)throw cdrRes.error;if(liveRes.error)throw liveRes.error;
      inject(document.getElementById('overview'),cdrRes.data||[],liveRes.data||[]);
    }else if(isCustomer&&profile.role==='customer'){
      const [cdrRes,liveRes]=await Promise.all([
        supabase.from('cdr').select('created_at,started_at,final_status,connected_seconds').eq('user_id',user.id).order('created_at',{ascending:false}).limit(500),
        supabase.from('live_calls').select('id,status').eq('user_id',user.id).limit(500)
      ]);
      if(cdrRes.error)throw cdrRes.error;if(liveRes.error)throw liveRes.error;
      inject(document.getElementById('dashboard'),cdrRes.data||[],liveRes.data||[]);
    }
  }catch(e){console.error('NX dashboard analytics failed',e);}
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,500),{once:true});else setTimeout(boot,500);
