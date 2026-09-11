import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon, type IconName } from './Icon';

export type MenuEntry =
  { id: string; label: string; icon?: IconName; onSelect(): void } | { separator: true };

interface MenuProps {
  label: string;
  items: readonly MenuEntry[];
  /** Escape or Tab: close without choosing. */
  onDismiss(): void;
  /** glass: floats over in-window content · thick: its own desktop window. */
  material?: 'glass' | 'thick';
  className?: string;
}

/** role="menu" with roving focus: arrows, Home/End; first item focused on open. */
export function Menu({ label, items, onDismiss, material = 'glass', className = '' }: MenuProps) {
  const root = useRef<HTMLDivElement>(null);
  const [navigating, setNavigating] = useState(false);
  useEffect(() => {
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, []);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      onDismiss();
      return;
    }
    const entries = [...root.current!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    const current = entries.indexOf(document.activeElement as HTMLButtonElement);
    const last = entries.length - 1;
    const next =
      event.key === 'ArrowDown'
        ? current === last
          ? 0
          : current + 1
        : event.key === 'ArrowUp'
          ? current <= 0
            ? last
            : current - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : -1;
    if (next >= 0) {
      event.preventDefault();
      setNavigating(true);
      entries[next].focus();
    }
  }

  return (
    <div
      ref={root}
      role="menu"
      aria-label={label}
      data-navigating={navigating || undefined}
      className={`ds-menu ${material === 'thick' ? 'ds-glass-thick' : 'ds-glass'} ${className}`}
      onKeyDown={onKeyDown}
    >
      {items.map((item, index) =>
        'separator' in item ? (
          <div key={`separator-${index}`} role="separator" className="ds-menu-separator" />
        ) : (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className="ds-menu-item"
            // Move focus with the pointer so keyboard and mouse share one highlight.
            onMouseEnter={event => event.currentTarget.focus()}
            onClick={item.onSelect}
          >
            <span>{item.label}</span>
            {item.icon && <Icon name={item.icon} size={15} />}
          </button>
        ),
      )}
    </div>
  );
}
