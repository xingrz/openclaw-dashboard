// === OpenClaw Dashboard Client ===

const $ = id => document.getElementById(id);
let ws = null;
let reconnectTimer = null;

// --- Formatting ---
function formatTokens(n) {
  if (n == null) return '--';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}

function formatCost(n) {
  if (n == null) return '--';
  return '$' + n.toFixed(2);
}

function formatPercent(n) {
  if (n == null) return '--';
  return n.toFixed(1) + '%';
}

function timeAgo(ms) {
  if (!ms && ms !== 0) return '--';
  // If ms is age in milliseconds
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return minutes + 'm ago';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + 'h ago';
  return Math.floor(hours / 24) + 'd ago';
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// --- Clock ---
function updateClock() {
  const now = new Date();
  $('clock').textContent = now.toLocaleTimeString('zh-CN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });
}
setInterval(updateClock, 1000);
updateClock();

// --- Channel type from session key ---
function detectChannel(session) {
  const key = session.key || '';
  if (key.includes('telegram')) return 'telegram';
  if (key.includes('webchat') || key.includes(':main')) return 'webchat';
  if (key.includes('wecom')) return 'wecom';
  if (key.includes('cron')) return 'cron';
  if (key.includes('feishu')) return 'feishu';
  if (key.includes('discord')) return 'discord';
  return 'unknown';
}

// --- Render Functions ---
function renderVersion(data) {
  const ver = data.status?.runtimeVersion || data.health?.version || '--';
  $('version').textContent = 'v' + ver;
}

function renderHealth(data) {
  const ind = $('health-indicator');
  const health = data.health;

  if (!health) {
    ind.className = 'status-indicator disconnected';
    ind.querySelector('.label').textContent = 'NO DATA';
    return;
  }

  const isOk = health.ok;
  ind.className = 'status-indicator ' + (isOk ? 'healthy' : 'degraded');
  ind.querySelector('.label').textContent = isOk ? 'HEALTHY' : 'DEGRADED';

  // Channels from health data
  const channels = health.channels || {};
  const list = $('channel-list');
  const entries = Object.entries(channels);

  if (entries.length === 0) {
    // Try from status
    const summary = data.status?.channelSummary || [];
    if (summary.length > 0) {
      list.innerHTML = summary.map(line => `
        <div class="channel-item">
          <div class="channel-dot ${line.toLowerCase().includes('configured') ? 'ok' : 'error'}"></div>
          <div class="channel-name">${escapeHtml(line.replace(/^\s*-\s*/, ''))}</div>
        </div>
      `).join('');
    }
    return;
  }

  list.innerHTML = entries.map(([name, ch]) => {
    const ok = ch.probe?.ok || ch.configured;
    const label = health.channelLabels?.[name] || name;
    let detail = '';
    if (ch.probe?.bot?.username) detail = '@' + ch.probe.bot.username;
    else if (ch.probe?.appId) detail = ch.probe.appId;
    return `
      <div class="channel-item">
        <div class="channel-dot ${ok ? 'ok' : 'error'}"></div>
        <div class="channel-name">${escapeHtml(label)}</div>
        <div class="channel-status">${escapeHtml(detail)}</div>
      </div>
    `;
  }).join('');
}

function renderUsageCost(data) {
  const uc = data.usageCost;
  if (!uc || !uc.totals) return;

  const totals = uc.totals;
  $('total-tokens').textContent = formatTokens(totals.totalTokens);
  $('total-cost').textContent = formatCost(totals.totalCost);
  $('output-tokens').textContent = formatTokens(totals.output);

  // Cache ratio
  const totalInput = (totals.input || 0) + (totals.cacheRead || 0) + (totals.cacheWrite || 0);
  const cacheRate = totalInput > 0 ? ((totals.cacheRead || 0) / totalInput * 100) : 0;
  $('cache-rate').textContent = formatPercent(cacheRate);

  // Today's stats - find today's entry
  const daily = uc.daily || [];
  const today = daily.length > 0 ? daily[daily.length - 1] : null;
  if (today) {
    $('today-tokens').textContent = formatTokens(today.totalTokens);
    $('today-cost').textContent = formatCost(today.totalCost);
    $('today-output').textContent = formatTokens(today.output);
    $('today-cache-read').textContent = formatTokens(today.cacheRead);
  }

  renderCostBars(totals);
  renderChart(daily);
}

function renderCostBars(totals) {
  const bars = $('cost-bars');
  const items = [
    { label: 'Cache Write', value: totals.cacheWriteCost || 0, color: 'var(--accent-purple)' },
    { label: 'Cache Read', value: totals.cacheReadCost || 0, color: 'var(--accent-cyan)' },
    { label: 'Output', value: totals.outputCost || 0, color: 'var(--accent-green)' },
    { label: 'Input', value: totals.inputCost || 0, color: 'var(--accent-yellow)' },
  ];
  const maxVal = Math.max(...items.map(i => i.value), 0.01);

  bars.innerHTML = items.map(item => `
    <div class="cost-bar-item">
      <div class="cost-bar-header">
        <span>${item.label}</span>
        <span>${formatCost(item.value)}</span>
      </div>
      <div class="cost-bar-track">
        <div class="cost-bar-fill" style="width:${(item.value / maxVal * 100).toFixed(1)}%; background:${item.color}; color:${item.color}"></div>
      </div>
    </div>
  `).join('');
}

function renderChart(daily) {
  const canvas = $('usage-chart');
  if (!canvas || !daily || daily.length === 0) return;

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = 120 * dpr;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = '120px';
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = 120;
  const pad = { top: 10, right: 10, bottom: 25, left: 50 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  ctx.clearRect(0, 0, w, h);

  const costs = daily.map(d => d.totalCost || 0);
  const maxCost = Math.max(...costs, 0.1);
  const n = costs.length;

  // Grid
  ctx.strokeStyle = '#1a2540';
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (plotH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
    ctx.fillStyle = '#3a4a6b';
    ctx.font = '9px JetBrains Mono';
    ctx.textAlign = 'right';
    ctx.fillText('$' + (maxCost * (1 - i / 4)).toFixed(2), pad.left - 5, y + 3);
  }

  if (n < 2) return;

  // Area
  const gradient = ctx.createLinearGradient(0, pad.top, 0, h - pad.bottom);
  gradient.addColorStop(0, 'rgba(0, 240, 255, 0.2)');
  gradient.addColorStop(1, 'rgba(0, 240, 255, 0)');

  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = pad.left + (i / (n - 1)) * plotW;
    const y = pad.top + plotH - (costs[i] / maxCost) * plotH;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.lineTo(pad.left + plotW, pad.top + plotH);
  ctx.lineTo(pad.left, pad.top + plotH);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  // Line
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = pad.left + (i / (n - 1)) * plotW;
    const y = pad.top + plotH - (costs[i] / maxCost) * plotH;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.strokeStyle = '#00f0ff';
  ctx.lineWidth = 2;
  ctx.shadowColor = '#00f0ff';
  ctx.shadowBlur = 6;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Dots
  const startDot = Math.max(0, n - 7);
  for (let i = startDot; i < n; i++) {
    const x = pad.left + (i / (n - 1)) * plotW;
    const y = pad.top + plotH - (costs[i] / maxCost) * plotH;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = i === n - 1 ? '#00ff88' : '#00f0ff';
    ctx.fill();
  }

  // X labels
  ctx.fillStyle = '#3a4a6b';
  ctx.font = '9px JetBrains Mono';
  ctx.textAlign = 'center';
  const dates = daily.map(d => d.date);
  if (dates.length > 0) {
    ctx.fillText(dates[0]?.slice(5) || '', pad.left, h - 5);
    if (dates.length > 2) {
      const mid = Math.floor(dates.length / 2);
      ctx.fillText(dates[mid]?.slice(5) || '', pad.left + (mid / (n - 1)) * plotW, h - 5);
    }
    ctx.fillText(dates[n - 1]?.slice(5) || '', pad.left + plotW, h - 5);
  }
}

function renderSessions(data) {
  // Use status.sessions.recent which has rich data
  const sessions = data.status?.sessions?.recent || [];
  $('session-count').textContent = sessions.length;

  const list = $('session-list');
  if (sessions.length === 0) {
    list.innerHTML = '<div style="color:var(--text-muted);font-size:0.8em;padding:12px">No sessions</div>';
    return;
  }

  list.innerHTML = sessions.map(s => {
    const channel = detectChannel(s);
    const shortKey = s.key
      .replace('agent:main:', '')
      .replace(/:[a-f0-9-]{20,}/g, '')
      .replace(/:\d{6,}/g, '');

    const pct = s.percentUsed != null ? s.percentUsed + '%' : '--';
    const tokens = s.totalTokens != null ? formatTokens(s.totalTokens) : '--';
    const model = (s.model || '').replace('claude-', '').replace('-4-6', '');

    return `
      <div class="session-item">
        <span class="session-channel ${channel}">${channel}</span>
        <span class="session-key" title="${escapeHtml(s.key)}">${escapeHtml(shortKey)}</span>
        <span class="session-tokens">${tokens}</span>
        <span class="session-pct ${s.percentUsed > 50 ? 'accent-yellow' : ''}">${pct}</span>
        <span class="session-time">${timeAgo(s.age)}</span>
      </div>
    `;
  }).join('');
}

function renderPresence(data) {
  const presence = data.presence || [];
  const container = $('presence-list');
  if (!container) return;

  if (presence.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:0.8em">No devices</div>';
    return;
  }

  container.innerHTML = presence.map(p => {
    const isActive = p.reason !== 'disconnect';
    return `
      <div class="presence-item">
        <div class="presence-dot ${isActive ? 'active' : 'inactive'}"></div>
        <div class="presence-info">
          <div class="presence-name">${escapeHtml(p.host || 'unknown')}</div>
          <div class="presence-detail">${escapeHtml(p.mode || '')} · ${escapeHtml(p.platform || '')}</div>
        </div>
      </div>
    `;
  }).join('');
}

function renderAll(data) {
  renderVersion(data);
  renderHealth(data);
  renderUsageCost(data);
  renderSessions(data);
  renderPresence(data);
  $('last-update').textContent = 'Last update: ' + new Date(data.timestamp).toLocaleTimeString('zh-CN');
}

// --- WebSocket ---
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  // Detect base path from current URL (e.g., /dashboard/)
  const basePath = location.pathname.replace(/\/+$/, '');
  const url = `${proto}://${location.host}${basePath}/ws`;

  ws = new WebSocket(url);
  $('ws-status').textContent = 'WS: connecting...';
  $('ws-status').style.color = 'var(--text-muted)';

  ws.onopen = () => {
    $('ws-status').textContent = 'WS: connected';
    $('ws-status').style.color = 'var(--accent-green)';
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  };

  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'metrics') renderAll(msg.data);
    } catch {}
  };

  ws.onclose = () => {
    $('ws-status').textContent = 'WS: disconnected';
    $('ws-status').style.color = 'var(--accent-red)';
    const ind = $('health-indicator');
    ind.className = 'status-indicator disconnected';
    ind.querySelector('.label').textContent = 'DISCONNECTED';
    scheduleReconnect();
  };

  ws.onerror = () => ws.close();
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connectWS(); }, 3000);
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- Resize handler ---
window.addEventListener('resize', () => {
  if (window._lastMetrics) renderUsageCost(window._lastMetrics);
});

const _origRender = renderAll;
renderAll = function(data) {
  window._lastMetrics = data;
  _origRender(data);
};

// Start
connectWS();

// Fallback REST
setTimeout(() => {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    const apiBase = location.pathname.replace(/\/+$/, '');
    fetch(apiBase + '/api/metrics').then(r => r.json()).then(renderAll).catch(() => {});
  }
}, 5000);
