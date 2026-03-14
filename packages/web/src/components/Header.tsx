import { useClock } from '../hooks/useClock';
import type { DashboardMetrics, ChannelHealth } from '../lib/types';

interface HeaderProps {
  data: DashboardMetrics | null;
}

export function Header({ data }: HeaderProps) {
  const clock = useClock();

  const health = data?.health;
  const status = data?.status;
  const presence = data?.presence ?? [];
  const stats = data?.activity?.stats;
  const sessions = status?.sessions?.recent ?? [];

  let healthClass = 'disconnected';
  let healthLabel = 'NO DATA';
  if (health) {
    healthClass = health.ok ? 'healthy' : 'degraded';
    healthLabel = health.ok ? 'HEALTHY' : 'DEGRADED';
  }

  const channelEntries = Object.entries(health?.channels ?? {});

  const activePresence = presence.filter((p) => p.reason !== 'disconnect');
  const shownPresence = activePresence.length > 0 ? activePresence : presence;

  return (
    <header className="header">
      <div className="header-left">
        <span className="logo">🦞</span>
        <h1>OPENCLAW</h1>
        <span className="version">v{status?.runtimeVersion ?? '--'}</span>
      </div>
      <div className="header-center">
        <div className="live-counters">
          <div className="counter">
            <span className="counter-value">{stats?.messages ?? 0}</span>
            <span className="counter-label">Messages</span>
          </div>
          <div className="counter">
            <span className="counter-value">{stats?.toolCalls ?? 0}</span>
            <span className="counter-label">Tool Calls</span>
          </div>
          <div className="counter">
            <span className="counter-value">{sessions.length}</span>
            <span className="counter-label">Sessions</span>
          </div>
        </div>
      </div>
      <div className="header-mid">
        <div className="inline-status">
          {channelEntries.map(([name, ch]) => {
            const { probe, configured } = ch as ChannelHealth;
            const ok = probe?.ok || configured;
            const label = health?.channelLabels?.[name] ?? name;
            return (
              <span key={name}>
                <span className={`inline-dot ${ok ? 'ok' : 'error'}`} />
                <span className="inline-name">{label}</span>
              </span>
            );
          })}
        </div>
        <div className="inline-status">
          {shownPresence.map((p, i) => {
            const isActive = p.reason !== 'disconnect';
            const name = p.host || p.deviceId?.slice(0, 12) || '?';
            return (
              <span key={p.deviceId ?? i}>
                <span className={`inline-dot ${isActive ? 'active' : 'inactive'}`} />
                <span className="inline-name">{name}</span>
              </span>
            );
          })}
        </div>
      </div>
      <div className="header-right">
        <div className={`status-indicator ${healthClass}`}>
          <span className="dot" />
          <span className="label">{healthLabel}</span>
        </div>
        <div className="clock">{clock}</div>
      </div>
    </header>
  );
}
