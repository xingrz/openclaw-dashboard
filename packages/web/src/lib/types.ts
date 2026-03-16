// ── Dashboard Metrics Types ────────────────────────────────

export interface DashboardMetrics {
  timestamp: number;
  gwConnected: boolean;
  health?: HealthData;
  status?: StatusData;
  presence?: PresenceItem[];
  usageCost?: UsageCostData;
  system: SystemSnapshot;
  activity: ActivitySnapshot;
}

export interface SystemSnapshot {
  cpuPercent?: number;
  memPercent: number;
}

export interface HealthData {
  ok: boolean;
  channels?: Record<string, ChannelHealth>;
  channelLabels?: Record<string, string>;
}

export interface ChannelHealth {
  probe?: { ok: boolean };
  configured?: boolean;
}

export interface StatusData {
  runtimeVersion?: string;
  sessions?: {
    recent?: SessionItem[];
  };
}

export interface SessionItem {
  key: string;
  totalTokens?: number;
  percentUsed?: number;
  age?: number;
}

export interface UsageCostData {
  totals?: UsageTotals;
  daily?: DailyUsage[];
}

export interface UsageTotals {
  totalTokens?: number;
  totalCost?: number;
  output?: number;
  input?: number;
  cacheRead?: number;
  cacheWrite?: number;
  inputCost?: number;
  outputCost?: number;
  cacheReadCost?: number;
  cacheWriteCost?: number;
}

export interface DailyUsage {
  date: string;
  totalTokens?: number;
  totalCost?: number;
  output?: number;
  cacheRead?: number;
}

export interface ActivitySnapshot {
  recent: ActivityItem[];
  stats: ActivityStats;
  hourlyActivity: number[];
  tasks: TaskItem[];
}

export interface ActivityItem {
  type: 'tool_call' | 'message' | 'user_message';
  ts: string;
  session: string;
  icon: string;
  seq: number;
  text?: string;
  tool?: string;
}

export interface ActivityStats {
  messages: number;
  toolCalls: number;
  errors: number;
  lastActivityAt: string | null;
}

export interface TaskItem {
  key: string;
  title: string;
  task: string;
  startedAt: string;
  lastActivityAt: string;
  isActive: boolean;
  toolCount: number;
  result: string | null;
  sessionFile: string;
}

export interface PresenceItem {
  reason?: string;
  host?: string;
  deviceId?: string;
}
