import { supabase } from './supabase-client.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const fmtMinutes = (seconds) => {
  const n = Math.max(0, Number(seconds || 0)) / 60;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
};
let currentDid = null;

function ensureMobileAdminNav() {
  if (document.getElementById('nxMobileMenuBtn')) return;
  const sidebar = document.querySelector('.sidebar');
  const top = document.querySelector('.top');
  if (!sidebar || !top) return;

  const style = document.createElement('style');
  style.id = 'nxMobileAdminStyles';
  style.textContent = `
    .nx-mobile-menu-btn{display:none!important;align-items:center;justify-content:center;width:42px;height:42px;padding:0;border-radius:12px;flex:0 0 auto}
    .nx-mobile-menu-btn svg{width:21px;height:21px}
    .nx-mobile-backdrop{display:none;position:fixed;inset:0;background:rgba(15,23,42,.48);backdrop-filter:blur(2px);z-index:1001}
    @media(max-width:760px){
      .nx-mobile-menu-btn{display:inline-flex!important}
      .sidebar{display:flex!important;width:min(82vw,300px)!important;transform:translateX(-105%);transition:transform .22s ease;z-index:1002!important;box-shadow:20px 0 45px rgba(2,6,23,.25);overflow-y:auto}
      .sidebar.nx-mobile-open{transform:translateX(0)}
      .nx-mobile-backdrop.nx-mobile-open{display:block}
      body.nx-menu-open{overflow:hidden}
      .top{justify-content:flex-start!important;gap:10px}
      .top h1{margin-right:auto!important}
      .top .actions{gap:6px}
      .top .actions .badge{display:none}
      .top .actions .btn.primary{padding:9px 10px;font-size:12px;white-space:nowrap}
      .sidebar .nav{padding:12px;font-size:13px}
    }
  `;
  document.head.appendChild(style);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn nx-mobile-menu-btn';
  button.id = 'nxMobileMenuBtn';
  button.setAttribute('aria-label', 'Open admin menu');
  button.setAttribute('aria-expanded', 'false');
  button.innerHTML = '<i data-lucide="menu"></i>';
  top.insertBefore(button, top.firstChild);

  const backdrop = document.createElement('div');
  backdrop.className = 'nx-mobile-backdrop';
  backdrop.id = 'nxMobileBackdrop';
  document.body.appendChild(backdrop);

  const closeMenu = () => {
    sidebar.classList.remove('nx-mobile-open');
    backdrop.classList.remove('nx-mobile-open');
    document.body.classList.remove('nx-menu-open');
    button.setAttribute('aria-expanded', 'false');
    button.innerHTML = '<i data-lucide="menu"></i>';
    window.lucide?.createIcons?.();
  };
  const openMenu = () => {
    sidebar.classList.add('nx-mobile-open');
    backdrop.classList.add('nx-mobile-open');
    document.body.classList.add('nx-menu-open');
    button.setAttribute('aria-expanded', 'true');
    button.innerHTML = '<i data-lucide="x"></i>';
    window.lucide?.createIcons?.();
  };

  button.addEventListener('click', () => sidebar.classList.contains('nx-mobile-open') ? closeMenu() : openMenu());
  backdrop.addEventListener('click', closeMenu);
  sidebar.querySelectorAll('.nav[data-page]').forEach(nav => nav.addEventListener('click', closeMenu));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMenu(); });
  window.addEventListener('resize', () => { if (window.innerWidth > 760) closeMenu(); });
  window.lucide?.createIcons?.();
}

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
    <div class="modal-actions"><button class="btn red" id="nxDidDelete" style="margin-right:auto;display:none">Delete DID</button><button class="btn" id="nxDidCancel">Cancel</button><button class="btn primary" id="nxDidSave">Save DID</button></div>
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
  const del = document.getElementById('nxDidDelete');
  del.style.display = currentDid ? 'inline-flex' : 'none';
  msg.textContent = currentDid?.user_id ? 'Assigned DID. Choose Unassigned to remove it from this customer.' : 'This DID is currently unassigned.';
  msg.style.color = '#667085';

  document.getElementById('nxDidSave').onclick = async () => {
    const save = document.getElementById('nxDidSave');
    save.disabled = true; msg.textContent = 'Saving…';
    try {
      const payload = {
        p_id: currentDid?.id || null,
        p_phone_number: document.getElementById('nxDidPhone').value.trim(),
        p_provider: document.getElementById('nxDidProvider').value.trim() || 'signalwire',
        p_label: document.getElementById('nxDidLabel').value.trim() || null,
        p_user_id: userSelect.value || null,
        p_enabled: document.getElementById('nxDidEnabled').value === 'true'
      };
      if (!payload.p_phone_number) throw new Error('Phone number is required.');
      const res = await supabase.rpc('admin_manage_did', payload);
      if (res.error) throw res.error;
      msg.textContent = payload.p_user_id ? 'DID assigned successfully.' : 'DID saved as unassigned inventory.';
      msg.style.color = '#067647';
      await reload();
      setTimeout(() => document.getElementById('nxDidModal')?.classList.remove('open'), 500);
    } catch (e) {
      msg.textContent = e?.message || 'DID update failed.'; msg.style.color = '#b42318';
    } finally { save.disabled = false; }
  };

  del.onclick = async () => {
    if (!currentDid) return;
    if (!window.confirm(`Delete ${currentDid.phone_number} from DID inventory?`)) return;
    del.disabled = true;
    msg.textContent = 'Deleting DID…';
    msg.style.color = '#667085';
    try {
      const res = await supabase.rpc('admin_delete_did', { p_id: currentDid.id });
      if (res.error) throw res.error;
      msg.textContent = 'DID deleted.';
      msg.style.color = '#067647';
      await reload();
      setTimeout(() => document.getElementById('nxDidModal')?.classList.remove('open'), 400);
    } catch (e) {
      msg.textContent = e?.message || 'DID delete failed.';
      msg.style.color = '#b42318';
    } finally { del.disabled = false; }
  };

  document.getElementById('nxDidModal').classList.add('open');
}

export async function setupAdminPhase3() {
  if (!/admin\.html$/i.test(location.pathname)) return;
  ensureMobileAdminNav();
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
      if (stats.tfns) stats.tfns.textContent = data.numbers.filter(n => n.enabled !== false && !!n.user_id).length;
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
