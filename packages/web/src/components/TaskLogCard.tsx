import type { CSSProperties } from 'react';
import { fmtTime, getChannelTagStyle } from '../lib/format';
import type { TaskItem } from '../lib/types';

interface TaskLogCardProps {
  tasks: TaskItem[];
}

export function TaskLogCard({ tasks }: TaskLogCardProps) {
  return (
    <div className="card">
      <div className="card-header">
        <span className="card-icon">📋</span>
        <span className="card-title">TASK LOG</span>
      </div>
      <div className="card-body">
        <div className="task-log">
          {tasks.length === 0 ? (
            <div className="empty">暂无任务记录</div>
          ) : (
            tasks.map((t) => <TaskRow key={t.sessionFile + t.startedAt} task={t} />)
          )}
        </div>
      </div>
    </div>
  );
}

function TaskRow({ task: t }: { task: TaskItem }) {
  const now = Date.now();
  const elapsed = now - new Date(t.lastActivityAt).getTime();
  const isActive = t.isActive;
  const isRecent = elapsed < 2 * 3600 * 1000;

  const statusClass = isActive ? 'task-active' : isRecent ? 'task-recent' : 'task-done';
  const statusLabel = isActive ? '进行中' : isRecent ? '刚完成' : '已完成';

  return (
    <div className={`task-item ${statusClass}`}>
      <div className="task-header">
        <span className="task-time">{fmtTime(t.startedAt)}</span>
        <span className="task-title">{t.title}</span>
        {t.toolCount > 0 && <span className="task-tools">🔧 {t.toolCount}</span>}
        {t.channel !== 'unknown' && (
          <span
            className="session-channel task-channel"
            style={getChannelTagStyle(t.channel) as CSSProperties}
            title={t.sessionKey || t.sessionFile}
          >
            {t.channel}
          </span>
        )}
        <span className="task-status">{statusLabel}</span>
      </div>
      <div className="task-desc">{t.task}</div>
      {t.result && <div className="task-result">{t.result}</div>}
    </div>
  );
}
