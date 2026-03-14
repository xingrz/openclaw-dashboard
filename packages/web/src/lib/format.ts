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

const CHANNEL_PREFIXES = ['telegram', 'wecom', 'cron', 'feishu', 'discord'] as const;

export function detectChannel(sessionKey: string): string {
  const key = sessionKey.replace(/^agent:[^:]+:/, '');
  if (key === 'main' || key.startsWith('webchat')) return 'webchat';
  return CHANNEL_PREFIXES.find((ch) => key.startsWith(ch)) ?? 'unknown';
}
