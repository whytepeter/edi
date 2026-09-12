import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

interface ListRowProps {
  icon: IconName;
  title: string;
  subtitle?: string;
  meta?: string;
  trailing?: ReactNode;
}

export function ListRow({ icon, title, subtitle, meta, trailing }: ListRowProps) {
  return (
    <li className="ds-row">
      <span className="ds-row-icon">
        <Icon name={icon} />
      </span>
      <div>
        <h3 className="ds-row-title">{title}</h3>
        {subtitle && <p className="ds-row-subtitle">{subtitle}</p>}
        {meta && <p className="ds-row-meta">{meta}</p>}
      </div>
      {trailing ?? <span />}
    </li>
  );
}

export function List({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul className="ds-list" aria-label={label}>
      {children}
    </ul>
  );
}
