import type { SystemSnapshot } from '../lib/types';

interface FooterProps {
  timestamp?: number;
  system?: SystemSnapshot;
}

function formatPercent(value?: number): string {
  return value == null ? '--' : `${Math.round(value)}%`;
}

export function Footer({ timestamp, system }: FooterProps) {
  const updated = timestamp
    ? 'Updated: ' + new Date(timestamp).toLocaleTimeString('zh-CN')
    : 'Last update: --';

  return (
    <footer className="footer">
      <span>🦐 虾折腾 Dashboard</span>
      <span>{updated}</span>
      <span style={{ color: 'var(--text2)' }}>
        CPU {formatPercent(system?.cpuPercent)} · MEM {formatPercent(system?.memPercent)}
      </span>
    </footer>
  );
}
