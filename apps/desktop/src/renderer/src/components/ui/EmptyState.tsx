import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/** A centered icon, heading and short explanation for a view with nothing in it yet. */
export function EmptyState({
  icon,
  title,
  children,
}: {
  icon: IconName;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon">
        <Icon name={icon} size={26} />
      </span>
      <h1 className="ds-title">{title}</h1>
      {children}
    </div>
  );
}
