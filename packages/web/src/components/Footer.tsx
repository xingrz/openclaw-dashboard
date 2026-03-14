import type { WsStatus } from '../hooks/useMetrics';

interface FooterProps {
  timestamp?: number;
  wsStatus: WsStatus;
}

export function Footer({ timestamp, wsStatus }: FooterProps) {
  const updated = timestamp
    ? 'Updated: ' + new Date(timestamp).toLocaleTimeString('zh-CN')
    : 'Last update: --';

  const wsColor =
    wsStatus === 'live'
      ? 'var(--green)'
      : wsStatus === 'connecting'
        ? 'var(--text2)'
        : 'var(--red)';

  return (
    <footer className="footer">
      <span>🦐 虾折腾 Dashboard</span>
      <span>{updated}</span>
      <span style={{ color: wsColor }}>WS: {wsStatus === 'live' ? 'live' : wsStatus === 'connecting' ? 'connecting...' : 'offline'}</span>
    </footer>
  );
}
