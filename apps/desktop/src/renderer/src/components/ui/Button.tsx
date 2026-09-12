import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** glass: default action · prominent: the one primary action · plain: tertiary. */
  variant?: 'glass' | 'prominent' | 'plain';
  size?: 'regular' | 'small';
  block?: boolean;
  trailingIcon?: IconName;
  children: ReactNode;
}

export function Button({
  variant = 'glass',
  size = 'regular',
  block = false,
  trailingIcon,
  className = '',
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`ds-button ${variant === 'glass' ? 'ds-glass' : ''} ${className}`}
      data-variant={variant}
      data-size={size}
      data-block={block || undefined}
      {...rest}
    >
      {children}
      {trailingIcon && <Icon name={trailingIcon} size={15} />}
    </button>
  );
}

interface IconButtonProps extends ComponentProps<'button'> {
  icon: IconName;
  /** Required: icon-only buttons need an accessible name. */
  label: string;
}

export function IconButton({ icon, label, className = '', ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      className={`ds-icon-button ${className}`}
      aria-label={label}
      title={label}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  );
}

/** A glass capsule grouping related toolbar controls. */
export function ToolbarGroup({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="ds-toolbar-group ds-glass" role="group" aria-label={label}>
      {children}
    </div>
  );
}
