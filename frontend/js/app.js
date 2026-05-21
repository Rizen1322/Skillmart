'use strict';
const API = '/api';

/* ── Storage ──────────────────────────────────────────────── */
const Storage = {
  get token()  { return localStorage.getItem('sm_tk'); },
  set token(v) { v ? localStorage.setItem('sm_tk', v) : localStorage.removeItem('sm_tk'); },
  get user()   { try { return JSON.parse(localStorage.getItem('sm_u')); } catch { return null; } },
  set user(v)  { v ? localStorage.setItem('sm_u', JSON.stringify(v)) : localStorage.removeItem('sm_u'); },
  getToken()   { return this.token; },
  setToken(v)  { this.token = v; },
  getUser()    { return this.user; },
  setUser(v)   { this.user = v; },
  clear()      { localStorage.removeItem('sm_tk'); localStorage.removeItem('sm_u'); },
  clearToken() { localStorage.removeItem('sm_tk'); },
  clearUser()  { localStorage.removeItem('sm_u'); },
};

function logout()     { Storage.clear(); location.href = '/'; }
function requireAuth(){ if (!Storage.token) { location.href = '/auth.html'; return false; } return true; }
function ifAuth()     { if (Storage.token) location.href = '/dashboard.html'; }

async function api(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (Storage.token) opts.headers['Authorization'] = 'Bearer ' + Storage.token;
  if (body !== null) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  let data = {};
  try { const t = await res.text(); if (t) data = JSON.parse(t); } catch {}
  if (res.status === 401) { logout(); return null; }
  if (!res.ok) throw new Error(data.error || data.errors?.[0]?.msg || 'HTTP ' + res.status);
  return data;
}

function toast(msg, type = 'info', dur = 3800) {
  let w = document.getElementById('toast-wrap');
  if (!w) { w = Object.assign(document.createElement('div'), { id: 'toast-wrap' }); document.body.appendChild(w); }
  const el = Object.assign(document.createElement('div'), { className: `toast toast-${type}` });
  el.innerHTML = `<div class="toast-icon">${{success:'✓',error:'✕',info:'ℹ'}[type]||'ℹ'}</div><span>${esc(msg)}</span>`;
  w.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 360); }, dur);
}
const toastOk  = m => toast(m, 'success');
const toastErr = m => toast(m, 'error');

function esc(s)      { const d = document.createElement('div'); d.textContent = String(s ?? ''); return d.innerHTML; }
function fmtPrice(p) { const n = parseFloat(p); return isNaN(n) ? '—' : new Intl.NumberFormat('ru-RU').format(n) + ' ₽'; }
function fmtDate(s)  { return s ? new Date(s).toLocaleDateString('ru-RU',{day:'numeric',month:'short',year:'numeric'}) : ''; }
function fmtTime(s)  { return s ? new Date(s).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}) : ''; }
function fmtStars(r) { const n = Math.round(+r||0); return `<span class="stars">${'★'.repeat(n)}${'☆'.repeat(5-n)}</span>`; }
function fmtStatus(s) {
  const m = { created:['Создан','s-created'], in_progress:['В работе','s-progress'], review:['На проверке','s-review'], completed:['Завершён','s-done'], cancelled:['Отменён','s-cancel'] };
  const [l,c] = m[s]||[s,''];
  return `<span class="status-badge ${c}">${l}</span>`;
}
function qp(k)   { return new URLSearchParams(location.search).get(k); }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function showLoader(el) { if (el) el.innerHTML = '<div class="loader-wrap"><div class="spinner"></div></div>'; }

const catIcons = { design:'🎨', programming:'💻', writing:'✍️', marketing:'📣', video:'🎬', photo:'📸', audio:'🎵', animation:'🎭', accounting:'📊', legal:'⚖️', education:'📚', ai:'🤖', mobile:'📱', games:'🎮', other:'🔧' };

let _nPoll = null;
let _nLast = 0;
let _nOpen = false;
const _nIcons = { order_created:'📦', order_accepted:'🔄', order_completed:'✅', order_cancelled:'❌', new_message:'💬', new_review:'⭐', payment_received:'💰', price_changed:'💱' };

function initBell() {
  if (!Storage.token) return;
  if (document.getElementById('nb-wrap')) return;

  const el = document.createElement('div');
  el.id = 'nb-wrap';
  el.innerHTML = `
    <button class="nb-btn" id="nb-btn" onclick="bellToggle(event)">
      🔔<span class="nb-badge" id="nb-badge" style="display:none">0</span>
    </button>
    <div class="nb-panel" id="nb-panel">
      <div class="nb-hdr">
        <span>Уведомления</span>
        <button onclick="bellMarkAll(event)">Прочитать все</button>
      </div>
      <div id="nb-list"><div class="loader-wrap" style="padding:1.5rem"><div class="spinner"></div></div></div>
      <a href="/dashboard.html" class="nb-footer" onclick="closeBell()">Перейти в кабинет →</a>
    </div>`;
  document.body.appendChild(el);

  document.addEventListener('click', e => {
    if (_nOpen && !el.contains(e.target)) closeBell();
  });

  pollNotifs();
  _nPoll = setInterval(pollNotifs, 8000);
}

async function pollNotifs() {
  try {
    const res = await api('/notifications');
    if (!res) return;
    const cnt = +(res.unread_count || 0);
    const badge = document.getElementById('nb-badge');
    if (badge) { badge.style.display = cnt > 0 ? 'flex' : 'none'; badge.textContent = cnt > 9 ? '9+' : cnt; }

    if (cnt > _nLast && _nLast !== 0) {
      const n = res.notifications?.[0];
      if (n) toast(`${n.title}${n.body?' — '+n.body.slice(0,55):''}`, 'info', 5500);
    }
    _nLast = cnt;

    if (_nOpen) renderNList(res.notifications || []);
  } catch {}
}

function renderNList(list) {
  const el = document.getElementById('nb-list'); if (!el) return;
  if (!list.length) { el.innerHTML = '<div style="text-align:center;padding:2rem 1rem;color:var(--muted);font-size:.82rem">Нет уведомлений</div>'; return; }
  el.innerHTML = list.slice(0, 12).map(n => `
    <div class="nb-item ${n.is_read?'':'unread'}" onclick="bellGo('${n.data?.order_id||''}')">
      <span class="nb-ico">${_nIcons[n.type]||'🔔'}</span>
      <div style="flex:1;min-width:0">
        <div class="nb-title">${esc(n.title)}</div>
        ${n.body?`<div class="nb-sub">${esc(n.body.slice(0,70))}</div>`:''}
        <div class="nb-time">${fmtTime(n.created_at)}</div>
      </div>
    </div>`).join('');
}

function bellToggle(e) { e.stopPropagation(); _nOpen ? closeBell() : openBell(); }
function openBell()    { _nOpen = true; document.getElementById('nb-panel')?.classList.add('open'); api('/notifications').then(r=>{ if(r) renderNList(r.notifications||[]); }).catch(()=>{}); }
function closeBell()   { _nOpen = false; document.getElementById('nb-panel')?.classList.remove('open'); }
async function bellMarkAll(e) { e.stopPropagation(); try { await api('/notifications/read-all','PATCH'); _nLast=0; pollNotifs(); } catch {} }
function bellGo(oid)   { closeBell(); if (oid) location.href='/dashboard.html?chat='+oid; }

document.addEventListener('DOMContentLoaded', () => { if (Storage.token) initBell(); });
