const CHANNEL_COLOR_OVERRIDES: Record<string, number> = {
  webchat: 188,
  telegram: 200,
  wecom: 142,
  cron: 275,
  feishu: 220,
  discord: 235,
};

export function fmtTokens(n: number | null | undefined): string {
  if (n == null) return '--';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return '' + n;
}

export function fmtCost(n: number | null | undefined): string {
  return n == null ? '--' : '$' + n.toFixed(2);
}

export function fmtPct(n: number | null | undefined): string {
  return n == null ? '--' : n.toFixed(1) + '%';
}

export function timeAgo(ms: number | null | undefined): string {
  if (!ms && ms !== 0) return '--';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'now';
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  return h < 24 ? h + 'h' : Math.floor(h / 24) + 'd';
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function normalizeChannel(channel: string | null | undefined): string {
  const value = (channel ?? '').trim().toLowerCase();
  if (!value) return 'unknown';
  if (value === 'main' || value.startsWith('webchat')) return 'webchat';
  return value;
}

export function detectChannel(sessionKey: string): string {
  const parts = sessionKey.split(':');
  if (parts[0] === 'agent' && parts.length >= 3) {
    return normalizeChannel(parts[2]);
  }

  const fallback = sessionKey.replace(/^agent:[^:]+:/, '').split(':')[0];
  return normalizeChannel(fallback);
}

function hashChannel(channel: string): number {
  let hash = 0;
  for (const ch of channel) {
    hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  }
  return hash;
}

export function getChannelTagStyle(channel: string): Record<string, string> {
  const normalized = detectChannel(channel);
  const hue = CHANNEL_COLOR_OVERRIDES[normalized] ?? hashChannel(normalized);

  return {
    '--tag-bg': `hsla(${hue}, 85%, 60%, 0.14)`,
    '--tag-fg': `hsl(${hue}, 100%, 72%)`,
    '--tag-border': `hsla(${hue}, 95%, 68%, 0.35)`,
  };
}
