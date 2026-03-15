import { GatewayClient } from './gateway-client.js';
import { ActivityTracker } from './activity-tracker.js';
import type { ActivitySnapshot } from './activity-tracker.js';

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
