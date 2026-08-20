import { supabase } from './supabase-client.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const fmtDur = (startedAt) => {
  if (!startedAt) return '00:00';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
};

function prettyCaller(value){
  const v=String(value||'').trim();
  if(!v) return '—';
  if(v.startsWith('sip:')) return 'Web / SIP Caller';
  return v;
}

function statusBadge(status){
  const s=String(status||'ringing').toLowerCase();
  const cls=s==='answered'||s==='live'||s==='in-progress'?'green':s==='ringing'?'amber':'blue';
  const label=s==='in-progress'?'Live':s.charAt(0).toUpperCase()+s.slice(1);
  return `<span class="badge ${cls}"><span class="dot"></span>${esc(label)}</span>`;
}

async function getUser(){
  const {data}=await supabase.auth.getSession();
  return data?.session?.user||null;
}

async function loadLive(){
  const user=await getUser();
  if(!user) return [];
  const {data,error}=await supabase.from('live_calls')
    .select('id,caller_number,dialed_number,forwarded_to,status,started_at,answered_at,campaign_id,destination_id')
    .eq('user_id',user.id)
    .order('started_at',{ascending:false});
  if(error) throw error;
  return data||[];
}

function render(rows){
  const page=document.getElementById('live');
  if(!page) return;
  const tbody=page.querySelector('tbody');
  if(!tbody) return;

  tbody.innerHTML=rows.length ? rows.map(r=>`<tr>
    <td><strong>${esc(prettyCaller(r.caller_number))}</strong></td>
    <td><strong>${esc(r.dialed_number||'—')}</strong></td>
    <td><strong>${esc(r.forwarded_to||'Routing…')}</strong><br><span class="mini">${r.forwarded_to?'Ringing / forwarding destination':'Waiting for route'}</span></td>
    <td>${statusBadge(r.answered_at?'answered':r.status)}</td>
    <td><strong data-live-start="${esc(r.started_at||'')}">${fmtDur(r.started_at)}</strong></td>
  </tr>`).join('') : '<tr><td colspan="5">No live calls.</td></tr>';

  const badge=document.querySelector('.nav-btn[data-page="live"] .badge');
  if(badge) badge.textContent=String(rows.length);
  const dashStat=[...document.querySelectorAll('#dashboard .grid4 .stat')][2]?.querySelector('strong');
  if(dashStat) dashStat.textContent=String(rows.length);
}

async function refresh(){
  try{ render(await loadLive()); }
  catch(e){ console.error('NX live calls refresh failed',e); }
}

function tickDurations(){
  document.querySelectorAll('[data-live-start]').forEach(el=>{
    el.textContent=fmtDur(el.getAttribute('data-live-start'));
  });
}

if(/index\.html$|\/$/.test(location.pathname)){
  const start=()=>{
    refresh();
    setInterval(refresh,2000);
    setInterval(tickDurations,1000);
  };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
}
