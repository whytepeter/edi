import { useEffect, useRef } from 'react';
import type { Command } from '@edi/contracts';

const items = [
  ['conversation', 'Conversation', '◌'],
  ['content', 'Show content', '↗'],
  ['stop', 'Stop / exit conversation', '□'],
  ['sleep', 'Sleep Edi', '☾'],
  ['quit', 'Quit Edi', '×'],
] as const;

export function CharacterMenu() {
  const root = useRef<HTMLDivElement>(null);
  const act = (action: Extract<Command, { type: 'character-action' }>['action']) =>
    void window.edi?.command({ type: 'character-action', action });
  useEffect(() => {
    root.current?.querySelector('button')?.focus();
  }, []);
  return (
    <div
      ref={root}
      className="character-menu"
      role="menu"
      aria-label="Edi options"
      onKeyDown={event => {
        if (event.key === 'Escape' || event.key === 'Tab') {
          event.preventDefault();
          act('dismiss');
          return;
        }
        const buttons = [...root.current!.querySelectorAll('button')];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next =
          event.key === 'ArrowDown'
            ? (index + 1) % buttons.length
            : event.key === 'ArrowUp'
              ? (index + buttons.length - 1) % buttons.length
              : event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? buttons.length - 1
                  : -1;
        if (next >= 0) {
          event.preventDefault();
          buttons[next].focus();
        }
      }}
    >
      {items.map(([action, label, icon]) => (
        <button key={action} role="menuitem" onClick={() => act(action)}>
          <span>{label}</span>
          <span aria-hidden="true" className="menu-glyph">
            {icon}
          </span>
        </button>
      ))}
    </div>
  );
}
