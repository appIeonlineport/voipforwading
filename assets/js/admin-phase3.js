import { supabase } from './supabase-client.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const fmtMinutes = (seconds) => {
  const n = Math.max(0, Number(seconds || 0)) / 60;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
};
let currentDid = null;

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
    if (!n.user_id) continue;
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
    </div>
    <div class="modal-actions"><button class="btn" id="nxManageCancel">Cancel</button><button class="btn primary" id="nxManageSave">Save Changes</button></div>
    <p id="nxManageMsg" style="font-size:11px;color:#667085"></p></div>`;
  document.body.appendChild(modal);
  document.getElementById('nxManageCancel').onclick = () => modal.classList.remove('open');
}

function ensureDidModal() {
  if (document.getElementById('nxDidModal')) return;
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.id = 'nxDidModal';
  modal.innerHTML = `<div class="box"><h3 id="nxDidTitle" style="margin-top:0">Add DID</h3>
    <div class="form">
      <div class="field span2"><label>Phone Number</label><input id="nxDidPhone" placeholder="+18022165132"></div>
      <div class="field"><label>Provider</label><input id="nxDidProvider" value="signalwire"></div>
      <div class="field"><label>Label</label><input id="nxDidLabel" placeholder="Primary TFN"></div>
      <div class="field span2"><label>Assigned Customer</label><select id="nxDidUser"><option value="">Unassigned</option></select></div>
      <div class="field span2"><label>Status</label><select id="nxDidEnabled"><option value="true">Enabled</option><option value="false">Disabled</option></select></div>
    </div>
    <div class="modal-actions"><button class="btn" id="nxDidCancel">Cancel</button><button class="btn primary" id="nxDidSave">Save DID</button></div>
    <p id="nxDidMsg" style="font-size:11px;color:#667085"></p></div>`;
  document.body.appendChild(modal);
  document.getElementById('nxDidCancel').onclick = () => modal.classList.remove('open');
}

async function saveCustomer(user, reload) {
  const msg = document.getElementById('nxManageMsg');
  const save = document.getElementById('nxManageSave');
  save.disabled = true; msg.textContent = 'Saving…'; msg.style.color = '#667085';
  try {
    const delta = Number(document.getElementById('nxAdjustMinutes').value || 0);
    const cc = Number(document.getElementById('nxManageCc').value || 0);
    const status = document.getElementById('nxManageStatus').value;
    const upd = await supabase.rpc('admin_update_customer', { p_user_id: user.id, p_status: status, p_max_concurrent_calls: cc });
    if (upd.error) throw upd.error;
    if (delta !== 0) {
      const adj = await supabase.rpc('admin_adjust_minutes', { p_user_id: user.id, p_minutes: delta, p_note: 'Admin panel adjustment' });
      if (adj.error) throw adj.error;
    }
    msg.textContent = 'Customer updated successfully.'; msg.style.color = '#067647';
    document.getElementById('nxAdjustMinutes').value = '0';
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
  document.getElementById('nxManageMsg').textContent = `Current balance: ${fmtMinutes(wallet?.remaining_seconds)} minutes`;
  document.getElementById('nxManageSave').onclick = () => saveCustomer(user, reload);
  document.getElementById('nxManageModal').classList.add('open');
}

function openDid(number, profiles, reload) {
  ensureDidModal();
  currentDid = number || null;
  document.getElementById('nxDidTitle').textContent = currentDid ? 'Manage DID / TFN' : 'Add DID / TFN';
  document.getElementById('nxDidPhone').value = currentDid?.phone_number || '';
  document.getElementById('nxDidProvider').value = currentDid?.provider || 'signalwire';
  document.getElementById('nxDidLabel').value = currentDid?.label || '';
  document.getElementById('nxDidEnabled').value = String(currentDid?.enabled !== false);
  const userSelect = document.getElementById('nxDidUser');
  userSelect.innerHTML = '<option value="">Unassigned</option>' + profiles.map(p => `<option value="${esc(p.id)}">${esc(p.full_name || p.email || 'Customer')} · ${esc(p.email || '')}</option>`).join('');
  userSelect.value = currentDid?.user_id || '';
  const msg = document.getElementById('nxDidMsg');
  msg.textContent = currentDid?.user_id ? 'Assigned DID. Choose Unassigned to remove it from this customer.' : 'This DID is currently unassigned.';
  msg.style.color = '#667085';
  document.getElementById('nxDidSave').onclick = async () => {
    const save = document.getElementById('nxDidSave');
    save.disabled = true; msg.textContent = 'Saving…';
    try {
      const payload = {
        phone_number: document.getElementById('nxDidPhone').value.trim(),
        provider: document.getElementById('nxDidProvider').value.trim() || 'signalwire',
        label: document.getElementById('nxDidLabel').value.trim() || null,
        user_id: userSelect.value || null,
        enabled: document.getElementById('nxDidEnabled').value === 'true',
        updated_at: new Date().toISOString()
      };
      if (!payload.phone_number) throw new Error('Phone number is required.');
      const res = currentDid
        ? await supabase.from('assigned_numbers').update(payload).eq('id', currentDid.id).select().single()
        : await supabase.from('assigned_numbers').insert(payload).select().single();
      if (res.error) throw res.error;
      msg.textContent = payload.user_id ? 'DID assigned successfully.' : 'DID saved as unassigned inventory.';
      msg.style.color = '#067647';
      await reload();
      setTimeout(() => document.getElementById('nxDidModal')?.classList.remove('open'), 500);
    } catch (e) {
      msg.textContent = e?.message || 'DID update failed.'; msg.style.color = '#b42318';
    } finally { save.disabled = false; }
  };
  document.getElementById('nxDidModal').classList.add('open');
}

export async function setupAdminPhase3() {
  if (!/admin\.html$/i.test(location.pathname)) return;
  ensureManageModal();
  ensureDidModal();
  const body = document.getElementById('usersBody');
  const inventoryBody = document.querySelector('#inventory tbody');
  const addDidBtn = document.querySelector('#inventory .hero .btn.primary');
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

      if (inventoryBody) {
        const users = new Map(data.profiles.map(p => [p.id,p]));
        inventoryBody.innerHTML = data.numbers.map(n => {
          const user = n.user_id ? users.get(n.user_id) : null;
          return `<tr>
            <td><strong>${esc(n.phone_number)}</strong><br><span style="color:#667085">${esc(n.label || '')}</span></td>
            <td>${esc(n.provider || '—')}</td>
            <td>${user ? `${esc(user.full_name || 'Customer')}<br><span style="color:#667085">${esc(user.email || '')}</span>` : '<span class="badge amber">Unassigned</span>'}</td>
            <td>—</td>
            <td><span class="badge ${n.enabled!==false?'green':'red'}">${n.enabled!==false?'Enabled':'Disabled'}</span></td>
            <td><button class="btn nx-manage-did" data-id="${esc(n.id)}">Manage</button></td>
          </tr>`;
        }).join('') || '<tr><td colspan="6">No DIDs in inventory.</td></tr>';
        inventoryBody.querySelectorAll('.nx-manage-did').forEach(btn => btn.addEventListener('click', () => {
          const number = data.numbers.find(x => x.id === btn.dataset.id);
          if (number) openDid(number, data.profiles, reload);
        }));
      }
      if (addDidBtn) addDidBtn.onclick = () => openDid(null, data.profiles, reload);
    } catch (e) {
      if (body) body.innerHTML = `<tr><td colspan="7" style="color:#b42318">${esc(e?.message || 'Could not load users')}</td></tr>`;
      if (inventoryBody) inventoryBody.innerHTML = `<tr><td colspan="6" style="color:#b42318">${esc(e?.message || 'Could not load DID inventory')}</td></tr>`;
      console.error('NX admin Phase 3', e);
    }
  }

  await reload();
  window.nxReloadAdmin = reload;
}
