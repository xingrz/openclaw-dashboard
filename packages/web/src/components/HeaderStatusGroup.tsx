interface HeaderStatusItem {
  key: string;
  label: string;
  tone: 'ok' | 'error' | 'active' | 'inactive';
}

interface HeaderStatusGroupProps {
  items: HeaderStatusItem[];
  emptyLabel: string;
  title?: string;
}

export function HeaderStatusGroup({ items, emptyLabel, title }: HeaderStatusGroupProps) {
  if (items.length === 0) {
    return (
      <div className="inline-status is-empty" aria-label={title ?? emptyLabel}>
        <span className="inline-muted">{emptyLabel}</span>
      </div>
    );
  }

  return (
    <div className="inline-status" aria-label={title}>
      {items.map((item) => (
        <span key={item.key} className="inline-item" title={item.label}>
          <span className={`inline-dot ${item.tone}`} />
          <span className="inline-name">{item.label}</span>
        </span>
      ))}
    </div>
  );
}
