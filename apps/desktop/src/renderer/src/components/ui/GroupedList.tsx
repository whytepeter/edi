import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/** An inset grouped list, like iOS Settings. Solid enough for dense text over any desktop. */
export function GroupedList({
  title,
  footer,
  children,
}: {
  title?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="ds-group-section">
      {title && <h2 className="ds-group-title">{title}</h2>}
      <ul className="ds-group" aria-label={title}>
        {children}
      </ul>
      {footer && <p className="ds-group-footer">{footer}</p>}
    </section>
  );
}

interface GroupedRowProps {
  icon?: IconName;
  title: string;
  detail?: ReactNode;
  value?: ReactNode;
  /** Makes the whole row a button that opens another page. */
  onOpen?(): void;
  /** A control at the trailing edge, such as a switch or button. */
  control?: ReactNode;
}

export function GroupedRow({ icon, title, detail, value, onOpen, control }: GroupedRowProps) {
  const body = (
    <>
      {icon && (
        <span className="ds-group-row-icon">
          <Icon name={icon} size={16} />
        </span>
      )}
      <span className="ds-group-row-text">
        <span className="ds-group-row-title">{title}</span>
        {detail && <span className="ds-group-row-detail">{detail}</span>}
      </span>
      {value !== undefined && <span className="ds-group-row-value">{value}</span>}
      {control}
      {onOpen && <Icon name="chevron-right" size={14} />}
    </>
  );
  return (
    <li>
      {onOpen ? (
        <button type="button" className="ds-group-row" data-link onClick={onOpen}>
          {body}
        </button>
      ) : (
        <div className="ds-group-row">{body}</div>
      )}
    </li>
  );
}
