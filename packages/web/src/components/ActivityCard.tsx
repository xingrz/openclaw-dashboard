import { fmtTime } from '../lib/format';
import type { ActivityItem } from '../lib/types';

interface ActivityCardProps {
  recent: ActivityItem[];
}

export function ActivityCard({ recent }: ActivityCardProps) {
  return (
    <div className="card">
      <div className="card-header">
        <span className="card-icon">⚡</span>
        <span className="card-title">LIVE ACTIVITY</span>
        <span className="badge pulse">{recent.length}</span>
      </div>
      <div className="card-body">
        <div className="activity-feed">
          {recent.length === 0 ? (
            <div className="empty">Waiting for activity...</div>
          ) : (
            recent.map((a) => <ActivityRow key={a.ts + a.type + a.session} activity={a} />)
          )}
        </div>
      </div>
    </div>
  );
}

function ActivityRow({ activity: a }: { activity: ActivityItem }) {
  const typeClass =
    a.type === 'tool_call'
      ? 'activity-tool'
      : a.type === 'user_message'
        ? 'activity-user'
        : 'activity-assistant';

  return (
    <div className={`activity-item ${typeClass}`} data-ts={a.ts}>
      <span className="activity-icon">{a.icon || '📌'}</span>
      <span className="activity-time">{fmtTime(a.ts)}</span>
      <span className="activity-text">{a.text || a.tool || a.type}</span>
    </div>
  );
}
