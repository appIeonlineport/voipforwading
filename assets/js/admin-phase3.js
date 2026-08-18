import { supabase } from './supabase-client.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const fmtMinutes = (seconds) => {
  const n = Math.max(0, Number(seconds || 0)) / 60;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
};

async function loadAdminData() {
  const [profilesRes, walletsRes, numbersRes, liveRes] = await Promise.all([
    supabase.from('profiles').select('id,email,full_name,role,status,max_concurrent_calls,created_at').eq('role','customer').order('created_at',{ascending:false}),
    supabase.from('minute_wallets').select('user_id,remaining_seconds,total_added_seconds,total_used_seconds'),
    supabase.from('assigned_numbers').select('id,user_id,phone_number,provider,label,enabled,created_at').order('created_at',{ascending:false}),
    supabase.from('live_calls').select('id,user_id,status')
  ]);
  for (const r of [profilesRes, walletsRes, numbersRes, liveRes]) if (r.error) throw r.error;
  const wallets = new Map((walletsRes.data || []).map(x => [x.user_id, x]));
  const numbersByUser = new Map();
  for (const n of numbersRes.data || []) {
    if (!numbersByUser.has(n.user_id)) numbersByUser.set(n.user_id, []);
    numbersByUser.get(n.user_id).push(n);
  }
  return { profiles: profilesRes.data || [], wallets, numbersByUser, live: liveRes.data || [], numbers: numbersRes.data || [] };
}

function ensureManageModal() {
  if (document.getElementById('nxManageModal')) return;
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.id = 'nxManageModal';
  modal.innerHTML = `<div class="box"><h3 style="margin-top:0">Manage Customer</h3>
    <div class="form">
      <div class="field span2"><label>Customer</label><input id="nxManageName" disabled></div>
      <div class="field"><label>Adjust Minutes (+/-)</label><input id="nxAdjustMinutes" type="number" step="0.1" value="0"></div>
      <div class="field"><label>Max CC</label><input id="nxManageCc" type="number" min="0"></div>
      <div class="field span2"><label>Status</label><select id="nxManageStatus"><option value="active">Active</option><option value="suspended">Suspended</option><option value="blocked">Blocked</option></select></div>
      <div class="field span2"><label>Assign TFN / DID</label><input id="nxAssignNumber" placeholder="+18022165132"></div>
    </div>
    <div class="modal-actions"><button class="btn" id="nxManageCancel">Cancel</button><button class="btn primary" id="nxManageSave">Save Changes</button></div>
    <p id="nxManageMsg" style="font-size:11px;color:#667085"></p></div>`;
  document.body.appendChild(modal);
  document.getElementById('nxManageCancel').onclick = () => modal.classList.remove('open');
}

async function saveCustomer(user, reload) {
  const msg = document.getElementById('nxManageMsg');
  const save = document.getElementById('nxManageSave');
  save.disabled = true; msg.textContent = 'Saving…'; msg.style.color = '#667085';
  try {
    const delta = Number(document.getElementById('nxAdjustMinutes').value || 0);
    const cc = Number(document.getElementById('nxManageCc').value || 0);
    const status = document.getElementById('nxManageStatus').value;
    const phone = document.getElementById('nxAssignNumber').value.trim();

    const upd = await supabase.rpc('admin_update_customer', { p_user_id: user.id, p_status: status, p_max_concurrent_calls: cc });
    if (upd.error) throw upd.error;

    if (delta !== 0) {
      const adj = await supabase.rpc('admin_adjust_minutes', { p_user_id: user.id, p_minutes: delta, p_note: 'Admin panel adjustment' });
      if (adj.error) throw adj.error;
    }

    if (phone) {
      const ins = await supabase.from('assigned_numbers').insert({ user_id: user.id, phone_number: phone, provider: 'signalwire', label: 'Admin assigned', enabled: true });
      if (ins.error) throw ins.error;
    }

    msg.textContent = 'Customer updated successfully.'; msg.style.color = '#067647';
    document.getElementById('nxAdjustMinutes').value = '0';
    document.getElementById('nxAssignNumber').value = '';
    await reload();
    setTimeout(() => document.getElementById('nxManageModal')?.classList.remove('open'), 500);
  } catch (e) {
    msg.textContent = e?.message || 'Update failed.'; msg.style.color = '#b42318';
  } finally { save.disabled = false; }
}

function openManage(user, wallet, reload) {
  ensureManageModal();
  document.getElementById('nxManageName').value = `${user.full_name || user.email || 'Customer'} · ${user.email || ''}`;
  document.getElementById('nxManageCc').value = user.max_concurrent_calls ?? 2;
  document.getElementById('nxManageStatus').value = user.status || 'active';
  document.getElementById('nxAdjustMinutes').value = '0';
  document.getElementById('nxAssignNumber').value = '';
  document.getElementById('nxManageMsg').textContent = `Current balance: ${fmtMinutes(wallet?.remaining_seconds)} minutes`;
  document.getElementById('nxManageSave').onclick = () => saveCustomer(user, reload);
  document.getElementById('nxManageModal').classList.add('open');
}

export async function setupAdminPhase3() {
  if (!/admin\.html$/i.test(location.pathname)) return;
  ensureManageModal();
  const body = document.getElementById('usersBody');
  const stats = {
    users: document.getElementById('statUsers'),
    tfns: document.getElementById('statTfns'),
    live: document.getElementById('statLive'),
    minutes: document.getElementById('statMinutes')
  };

  async function reload() {
    try {
      const data = await loadAdminData();
      if (stats.users) stats.users.textContent = data.profiles.length;
      if (stats.tfns) stats.tfns.textContent = data.numbers.filter(n => n.enabled !== false).length;
      if (stats.live) stats.live.textContent = data.live.length;
      const totalSeconds = [...data.wallets.values()].reduce((a,w)=>a+Number(w.remaining_seconds||0),0);
      if (stats.minutes) stats.minutes.textContent = fmtMinutes(totalSeconds);

      if (body) {
        body.innerHTML = data.profiles.map(user => {
          const wallet = data.wallets.get(user.id);
          const tfns = data.numbersByUser.get(user.id) || [];
          return `<tr>
            <td><strong>${esc(user.full_name || 'Customer')}</strong><br><span style="color:#667085">${esc(user.email || '')}</span></td>
            <td><span class="badge ${user.status==='active'?'green':user.status==='blocked'?'red':'amber'}">${esc(user.status)}</span></td>
            <td>${fmtMinutes(wallet?.remaining_seconds)}</td>
            <td>${esc(user.max_concurrent_calls ?? 0)}</td>
            <td>${tfns.length}</td>
            <td><span class="badge blue">Customer</span></td>
            <td><button class="btn nx-manage-user" data-id="${esc(user.id)}">Manage</button></td>
          </tr>`;
        }).join('') || '<tr><td colspan="7">No customer accounts found.</td></tr>';
        body.querySelectorAll('.nx-manage-user').forEach(btn => btn.addEventListener('click', () => {
          const user = data.profiles.find(x => x.id === btn.dataset.id);
          if (user) openManage(user, data.wallets.get(user.id), reload);
        }));
      }
    } catch (e) {
      if (body) body.innerHTML = `<tr><td colspan="7" style="color:#b42318">${esc(e?.message || 'Could not load users')}</td></tr>`;
      console.error('NX admin Phase 3', e);
    }
  }

  await reload();
  window.nxReloadAdmin = reload;
}
