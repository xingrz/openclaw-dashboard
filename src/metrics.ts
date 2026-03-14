import { execFile } from 'child_process';
import { promisify } from 'util';
import { GatewayClient } from './gateway-client.js';
import { ActivityTracker } from './activity-tracker.js';
import type { ActivitySnapshot } from './activity-tracker.js';

const execFileAsync = promisify(execFile);

export interface DashboardMetrics {
  timestamp: number;
  gwConnected: boolean;
  health?: unknown;
  status?: unknown;
  presence?: unknown;
  usageCost?: unknown;
  activity: ActivitySnapshot;
}

/** Collect all dashboard metrics from the gateway and local session logs. */
export async function collectMetrics(gw: GatewayClient, tracker: ActivityTracker): Promise<DashboardMetrics> {
  const result: DashboardMetrics = {
    timestamp: Date.now(),
    gwConnected: gw.connected,
    activity: tracker.getSnapshot(),
  };

  if (gw.connected) {
    const [health, status, presence] = await Promise.all([
      gw.call('health').catch(() => null),
      gw.call('status').catch(() => null),
      gw.call('system-presence').catch(() => null),
    ]);
    result.health = health;
    result.status = status;
    result.presence = presence;
  }

  result.usageCost = await fetchUsageCost();

  return result;
}

/** Fetch usage cost data via the OpenClaw CLI (non-blocking). */
async function fetchUsageCost(): Promise<unknown> {
  try {
    const { stdout } = await execFileAsync('openclaw', ['gateway', 'usage-cost', '--json'], {
      timeout: 15000,
      env: { ...process.env, NO_COLOR: '1' },
    });

    const raw = stdout.trim();
    const idx = raw.indexOf('{');
    if (idx >= 0) return JSON.parse(raw.slice(idx));
  } catch {
    // CLI may not be available or may fail; this is non-critical.
  }
  return undefined;
}
