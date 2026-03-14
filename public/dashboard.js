// === OpenClaw Dashboard Client ===
const $ = id => document.getElementById(id);
let ws = null, reconnectTimer = null;

// --- Formatting ---
function fmtTokens(n) {
  if (n == null) return '--';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return '' + n;
}
function fmtCost(n) { return n == null ? '--' : '$' + n.toFixed(2); }
function fmtPct(n) { return n == null ? '--' : n.toFixed(1) + '%'; }
function timeAgo(ms) {
  if (!ms && ms !== 0) return '--';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'now';
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  return h < 24 ? h + 'h' : Math.floor(h / 24) + 'd';
}
function fmtTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function esc(s) { return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// --- Clock ---
setInterval(() => {
  $('clock').textContent = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}, 1000);

// --- Channel detection ---
function detectChannel(s) {
  const key = (s.key || '').replace(/^agent:[^:]+:/, '');
  if (key.startsWith('telegram')) return 'telegram';
  if (key.startsWith('wecom')) return 'wecom';
  if (key.startsWith('cron')) return 'cron';
  if (key.startsWith('feishu')) return 'feishu';
  if (key.startsWith('discord')) return 'discord';
  if (key.startsWith('webchat') || key === 'main') return 'webchat';
  return 'unknown';
}

// --- Renderers ---
function renderVersion(d) { $('version').textContent = 'v' + (d.status?.runtimeVersion || '--'); }

function renderHealth(d) {
  const ind = $('health-indicator');
  const h = d.health;
  if (!h) { ind.className = 'status-indicator disconnected'; ind.querySelector('.label').textContent = 'NO DATA'; return; }
  ind.className = 'status-indicator ' + (h.ok ? 'healthy' : 'degraded');
  ind.querySelector('.label').textContent = h.ok ? 'HEALTHY' : 'DEGRADED';

  const channels = h.channels || {};
  const list = $('channel-list');
  const entries = Object.entries(channels);
  if (!entries.length) { list.innerHTML = ''; return; }
  list.innerHTML = entries.map(([name, ch]) => {
    const ok = ch.probe?.ok || ch.configured;
    const label = h.channelLabels?.[name] || name;
    return `<span class="inline-dot ${ok?'ok':'error'}"></span><span class="inline-name">${esc(label)}</span>`;
  }).join('');
}

function renderUsageCost(d) {
  const uc = d.usageCost;
  if (!uc?.totals) return;
  const t = uc.totals;
  $('total-tokens').textContent = fmtTokens(t.totalTokens);
  $('total-cost').textContent = fmtCost(t.totalCost);
  $('output-tokens').textContent = fmtTokens(t.output);
  const totalIn = (t.input||0) + (t.cacheRead||0) + (t.cacheWrite||0);
  $('cache-rate').textContent = fmtPct(totalIn > 0 ? (t.cacheRead||0)/totalIn*100 : 0);

  const daily = uc.daily || [];
  const today = daily.length ? daily[daily.length - 1] : null;
  if (today) {
    $('today-tokens').textContent = fmtTokens(today.totalTokens);
    $('today-cost').textContent = fmtCost(today.totalCost);
    $('today-output').textContent = fmtTokens(today.output);
    $('today-cache-read').textContent = fmtTokens(today.cacheRead);
  }
  renderCostBars(t);
  renderChart(daily);
}

function renderCostBars(t) {
  const items = [
    { label: 'Cache Write', value: t.cacheWriteCost||0, color: '#b366ff' },
    { label: 'Cache Read', value: t.cacheReadCost||0, color: '#00f0ff' },
    { label: 'Output', value: t.outputCost||0, color: '#00ff88' },
    { label: 'Input', value: t.inputCost||0, color: '#ffcc00' },
  ];
  const max = Math.max(...items.map(i => i.value), 0.01);
  $('cost-bars').innerHTML = items.map(i => `
    <div class="cost-bar-item"><div class="cost-bar-header"><span>${i.label}</span><span>${fmtCost(i.value)}</span></div>
    <div class="cost-bar-track"><div class="cost-bar-fill" style="width:${(i.value/max*100).toFixed(1)}%;background:${i.color};color:${i.color}"></div></div></div>
  `).join('');
}

function renderChart(daily) {
  const canvas = $('usage-chart');
  if (!canvas || !daily?.length) return;
  const ctx = canvas.getContext('2d');
  const dpr = devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  const chartH = Math.min(rect.height || 80, 100);
  canvas.width = rect.width * dpr; canvas.height = chartH * dpr;
  canvas.style.width = rect.width + 'px'; canvas.style.height = chartH + 'px';
  ctx.scale(dpr, dpr);
  const w = rect.width, h = chartH;
  const pad = { t: 10, r: 10, b: 25, l: 50 };
  const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
  ctx.clearRect(0, 0, w, h);
  const costs = daily.map(d => d.totalCost || 0);
  const max = Math.max(...costs, 0.1);
  const n = costs.length;
  ctx.strokeStyle = '#1a2540'; ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (ph / 4) * i;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    ctx.fillStyle = '#3a4a6b'; ctx.font = '9px JetBrains Mono'; ctx.textAlign = 'right';
    ctx.fillText('$' + (max * (1 - i / 4)).toFixed(2), pad.l - 5, y + 3);
  }
  if (n < 2) return;
  const grd = ctx.createLinearGradient(0, pad.t, 0, h - pad.b);
  grd.addColorStop(0, 'rgba(0,240,255,0.2)'); grd.addColorStop(1, 'rgba(0,240,255,0)');
  ctx.beginPath();
  costs.forEach((c, i) => { const x = pad.l + (i/(n-1))*pw, y = pad.t + ph - (c/max)*ph; i ? ctx.lineTo(x,y) : ctx.moveTo(x,y); });
  ctx.lineTo(pad.l + pw, pad.t + ph); ctx.lineTo(pad.l, pad.t + ph); ctx.closePath();
  ctx.fillStyle = grd; ctx.fill();
  ctx.beginPath();
  costs.forEach((c, i) => { const x = pad.l + (i/(n-1))*pw, y = pad.t + ph - (c/max)*ph; i ? ctx.lineTo(x,y) : ctx.moveTo(x,y); });
  ctx.strokeStyle = '#00f0ff'; ctx.lineWidth = 2; ctx.shadowColor = '#00f0ff'; ctx.shadowBlur = 6; ctx.stroke(); ctx.shadowBlur = 0;
  for (let i = Math.max(0, n - 7); i < n; i++) {
    const x = pad.l + (i/(n-1))*pw, y = pad.t + ph - (costs[i]/max)*ph;
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI*2); ctx.fillStyle = i === n-1 ? '#00ff88' : '#00f0ff'; ctx.fill();
  }
  ctx.fillStyle = '#3a4a6b'; ctx.font = '9px JetBrains Mono'; ctx.textAlign = 'center';
  const dates = daily.map(d => d.date);
  ctx.fillText(dates[0]?.slice(5)||'', pad.l, h - 5);
  if (n > 2) { const m = Math.floor(n/2); ctx.fillText(dates[m]?.slice(5)||'', pad.l+(m/(n-1))*pw, h-5); }
  ctx.fillText(dates[n-1]?.slice(5)||'', pad.l+pw, h-5);
}

function renderSessions(d) {
  const sessions = d.status?.sessions?.recent || [];
  $('session-count').textContent = sessions.length;
  $('cnt-sessions').textContent = sessions.length;
  const list = $('session-list');
  if (!sessions.length) { list.innerHTML = '<div class="empty">No sessions</div>'; return; }
  list.innerHTML = sessions.map(s => {
    const ch = detectChannel(s);
    const shortKey = s.key.replace('agent:main:', '').replace(/:[a-f0-9-]{20,}/g, '').replace(/:\d{6,}/g, '');
    const pct = s.percentUsed ?? 0;
    const tokens = fmtTokens(s.totalTokens);
    const ctxColor = pct > 70 ? '#ff3366' : pct > 40 ? '#ffcc00' : '#00f0ff';
    return `
      <div class="session-item">
        <span class="session-channel ${ch}">${ch}</span>
        <span class="session-key" title="${esc(s.key)}">${esc(shortKey)}</span>
        <span class="session-tokens">${tokens}</span>
        <div class="ctx-bar"><div class="ctx-bar-fill" style="width:${pct}%;background:${ctxColor}"></div></div>
        <span class="session-pct" style="color:${ctxColor}">${pct}%</span>
        <span class="session-time">${timeAgo(s.age)}</span>
      </div>`;
  }).join('');
}

let _lastActivityKey = '';
function renderActivity(d) {
  const activity = d.activity || {};
  const recent = activity.recent || [];
  const stats = activity.stats || {};
  $('activity-count').textContent = recent.length;
  $('cnt-messages').textContent = stats.messages || 0;
  $('cnt-tools').textContent = stats.toolCalls || 0;

  const feed = $('activity-feed');
  if (!recent.length) { feed.innerHTML = '<div class="empty">Waiting for activity...</div>'; _lastActivityKey = ''; return; }

  // Build a key from first few items to detect changes
  const newKey = recent.slice(0, 5).map(a => a.ts + a.type).join('|');
  if (newKey === _lastActivityKey) return; // No change, skip re-render

  // Find how many new items were added at the top
  const existingItems = feed.querySelectorAll('.activity-item');
  const existingFirstTs = existingItems[0]?.dataset?.ts;
  let newCount = 0;
  if (existingFirstTs) {
    for (let i = 0; i < recent.length; i++) {
      if (recent[i].ts === existingFirstTs) break;
      newCount++;
    }
  } else {
    newCount = recent.length; // First render
  }

  if (newCount === 0 && existingItems.length > 0) {
    _lastActivityKey = newKey;
    return; // Nothing new
  }

  if (newCount > 0 && newCount < recent.length && existingItems.length > 0) {
    // Prepend only new items (no animation flash on existing)
    const fragment = document.createDocumentFragment();
    for (let i = newCount - 1; i >= 0; i--) {
      const a = recent[i];
      const div = document.createElement('div');
      div.className = 'activity-item ' + (a.type === 'tool_call' ? 'activity-tool' : a.type === 'user_message' ? 'activity-user' : 'activity-assistant');
      div.dataset.ts = a.ts;
      div.innerHTML = `<span class="activity-icon">${a.icon||'📌'}</span><span class="activity-time">${fmtTime(a.ts)}</span><span class="activity-text">${esc(a.text || a.tool || a.type)}</span>`;
      fragment.appendChild(div);
    }
    feed.insertBefore(fragment, feed.firstChild);
    // Trim excess items
    while (feed.children.length > 50) feed.removeChild(feed.lastChild);
  } else {
    // Full re-render (first load or major change)
    feed.innerHTML = recent.map(a => {
      const typeClass = a.type === 'tool_call' ? 'activity-tool' : a.type === 'user_message' ? 'activity-user' : 'activity-assistant';
      return `<div class="activity-item ${typeClass}" data-ts="${esc(a.ts)}"><span class="activity-icon">${a.icon||'📌'}</span><span class="activity-time">${fmtTime(a.ts)}</span><span class="activity-text">${esc(a.text || a.tool || a.type)}</span></div>`;
    }).join('');
  }
  _lastActivityKey = newKey;

  // Hourly heatmap
  const hourly = activity.hourlyActivity || new Array(24).fill(0);
  const maxH = Math.max(...hourly, 1);
  const bars = $('hourly-bars');
  if (bars) {
    bars.innerHTML = hourly.map((v, i) => {
      const pct = (v / maxH * 100).toFixed(0);
      const now = new Date().getHours();
      const isNow = i === now;
      return `<div class="hbar${isNow ? ' hbar-now' : ''}" style="height:${Math.max(pct, 4)}%;opacity:${v > 0 ? 0.4 + 0.6*(v/maxH) : 0.15}" title="${i}:00 — ${v} events"></div>`;
    }).join('');
  }
}

function renderPresence(d) {
  const presence = d.presence || [];
  const container = $('presence-list');
  if (!container) return;
  const active = presence.filter(p => p.reason !== 'disconnect');
  const show = active.length > 0 ? active : presence;
  if (!show.length) { container.innerHTML = ''; return; }
  container.innerHTML = show.map(p => {
    const isActive = p.reason !== 'disconnect';
    const name = p.host || p.deviceId?.slice(0, 12) || '?';
    return `<span class="inline-dot ${isActive?'active':'inactive'}"></span><span class="inline-name">${esc(name)}</span>`;
  }).join('');
}

function renderTaskLog(d) {
  const tasks = d.activity?.tasks || [];
  const log = $('task-log');
  if (!log) return;
  if (!tasks.length) { log.innerHTML = '<div class="empty">暂无任务记录</div>'; return; }

  const now = Date.now();
  log.innerHTML = tasks.map(t => {
    const startTime = fmtTime(t.startedAt);
    const elapsed = now - new Date(t.lastActivityAt).getTime();
    // Active if last activity within 15 minutes
    const isActive = elapsed < 15 * 60 * 1000;
    // Recent if within 2 hours
    const isRecent = elapsed < 2 * 3600 * 1000;
    const status = isActive ? 'active' : isRecent ? 'recent' : 'done';
    const statusLabel = isActive ? '进行中' : isRecent ? '刚完成' : '已完成';
    const statusClass = isActive ? 'task-active' : isRecent ? 'task-recent' : 'task-done';

    const toolBadge = t.toolCount > 0 ? `<span class="task-tools">🔧 ${t.toolCount}</span>` : '';
    const resultLine = t.result ? `<div class="task-result">→ ${esc(t.result)}</div>` : '';

    return `
      <div class="task-item ${statusClass}">
        <div class="task-header">
          <span class="task-time">${startTime}</span>
          ${toolBadge}
          <span class="task-status">${statusLabel}</span>
        </div>
        <div class="task-desc">${esc(t.task)}</div>
        ${resultLine}
      </div>`;
  }).join('');
}

function renderAll(d) {
  renderVersion(d); renderHealth(d); renderUsageCost(d); renderSessions(d); renderActivity(d); renderPresence(d); renderTaskLog(d);
  $('last-update').textContent = 'Updated: ' + new Date(d.timestamp).toLocaleTimeString('zh-CN');
}

// --- WebSocket ---
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const base = location.pathname.replace(/\/+$/, '');
  ws = new WebSocket(`${proto}://${location.host}${base}/ws`);
  $('ws-status').textContent = 'WS: connecting...'; $('ws-status').style.color = 'var(--text-muted)';
  ws.onopen = () => { $('ws-status').textContent = 'WS: live'; $('ws-status').style.color = 'var(--accent-green)'; if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; } };
  ws.onmessage = e => { try { const m = JSON.parse(e.data); if (m.type === 'metrics') renderAll(m.data); } catch {} };
  ws.onclose = () => { $('ws-status').textContent = 'WS: offline'; $('ws-status').style.color = 'var(--accent-red)';
    $('health-indicator').className = 'status-indicator disconnected'; $('health-indicator').querySelector('.label').textContent = 'DISCONNECTED';
    if (!reconnectTimer) reconnectTimer = setTimeout(() => { reconnectTimer = null; connectWS(); }, 3000); };
  ws.onerror = () => ws.close();
}

window.addEventListener('resize', () => { if (window._last) renderUsageCost(window._last); });
const _render = renderAll;
renderAll = d => { window._last = d; _render(d); };

connectWS();
setTimeout(() => { if (!ws || ws.readyState !== WebSocket.OPEN) {
  const base = location.pathname.replace(/\/+$/, '');
  fetch(base + '/api/metrics').then(r=>r.json()).then(renderAll).catch(()=>{});
} }, 5000);
