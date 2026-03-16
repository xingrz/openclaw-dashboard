import { fmtTokens, fmtCost, fmtPct } from '../lib/format';
import { UsageChart } from './UsageChart';
import type { UsageCostData } from '../lib/types';

interface TokenUsageCardProps {
  usageCost?: UsageCostData;
}

export function TokenUsageCard({ usageCost }: TokenUsageCardProps) {
  const t = usageCost?.totals;
  const daily = usageCost?.daily ?? [];

  const totalIn = (t?.input ?? 0) + (t?.cacheRead ?? 0) + (t?.cacheWrite ?? 0);
  const cacheRate = totalIn > 0 ? ((t?.cacheRead ?? 0) / totalIn) * 100 : 0;

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-icon">📊</span>
        <span className="card-title">TOKEN USAGE (30d)</span>
      </div>
      <div className="card-body">
        <div className="metrics-row">
          <div className="metric">
            <div className="metric-value">{fmtTokens(t?.totalTokens)}</div>
            <div className="metric-label">Total</div>
          </div>
          <div className="metric">
            <div className="metric-value accent-green">{fmtCost(t?.totalCost)}</div>
            <div className="metric-label">Cost</div>
          </div>
          <div className="metric">
            <div className="metric-value accent-cyan">{fmtPct(t ? cacheRate : undefined)}</div>
            <div className="metric-label">Cached</div>
          </div>
          <div className="metric">
            <div className="metric-value accent-purple">{fmtTokens(t?.output)}</div>
            <div className="metric-label">Output</div>
          </div>
        </div>
        <div className="chart-container">
          <UsageChart daily={daily} />
        </div>
      </div>
    </div>
  );
}
