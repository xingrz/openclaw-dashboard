import os from 'node:os';
import { GatewayClient } from './gateway-client.js';
import { ActivityTracker } from './activity-tracker.js';
import type { ActivitySnapshot } from './activity-tracker.js';

export interface SystemSnapshot {
  cpuPercent?: number;
  memPercent: number;
}

export interface DashboardMetrics {
  timestamp: number;
  gwConnected: boolean;
  health?: unknown;
  status?: unknown;
  presence?: unknown;
  usageCost?: unknown;
  system: SystemSnapshot;
  activity: ActivitySnapshot;
}

let lastCpuSample: { idle: number; total: number } | null = null;

function sampleCpu(): number | undefined {
  const cpus = os.cpus();
  if (!cpus.length) return undefined;

  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
  }

  const current = { idle, total };
  const previous = lastCpuSample;
  lastCpuSample = current;

  if (!previous) return undefined;

  const totalDelta = current.total - previous.total;
  const idleDelta = current.idle - previous.idle;
  if (totalDelta <= 0) return undefined;

  const usedPercent = (1 - idleDelta / totalDelta) * 100;
  return Math.max(0, Math.min(100, usedPercent));
}

function sampleMemory(): number {
  const total = os.totalmem();
  const free = os.freemem();
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, ((total - free) / total) * 100));
}

/** Collect all dashboard metrics from the gateway and local session logs. */
export async function collectMetrics(gw: GatewayClient, tracker: ActivityTracker): Promise<DashboardMetrics> {
  const result: DashboardMetrics = {
    timestamp: Date.now(),
    gwConnected: gw.connected,
    system: {
      cpuPercent: sampleCpu(),
      memPercent: sampleMemory(),
    },
    activity: await tracker.getSnapshot(),
  };

  if (gw.connected) {
    const [health, status, presence, usageCost] = await Promise.all([
      gw.call('health').catch(() => null),
      gw.call('status').catch(() => null),
      gw.call('system-presence').catch(() => null),
      gw.call('usage.cost', { days: 30 }).catch(() => null),
    ]);
    result.health = health;
    result.status = status;
    result.presence = presence;
    result.usageCost = usageCost;
  }

  return result;
}
