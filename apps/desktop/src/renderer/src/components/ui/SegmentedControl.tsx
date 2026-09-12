import { useRef, type CSSProperties, type KeyboardEvent } from 'react';

interface SegmentedControlProps<T extends string> {
  label: string;
  options: readonly T[];
  value: T;
  onChange(value: T): void;
}

/** A radio group with a sliding glass thumb. Arrow keys move and select, like native. */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  const root = useRef<HTMLDivElement>(null);
  const index = Math.max(0, options.indexOf(value));

  function onKeyDown(event: KeyboardEvent) {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    const option = options[next];
    if (option === undefined) return;
    onChange(option);
    root.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  }

  return (
    <div
      ref={root}
      className="ds-segmented"
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      style={{ '--count': options.length, '--index': index } as CSSProperties}
    >
      <span className="ds-segmented-thumb ds-glass-thick" aria-hidden="true" />
      {options.map(option => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={option === value}
          tabIndex={option === value ? 0 : -1}
          className="ds-segmented-option"
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
