interface SwitchProps {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange(checked: boolean): void;
}

/** role="switch": Space and Enter toggle it, like a native checkbox. */
export function Switch({ label, checked, disabled, onChange }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      className="ds-switch"
      onClick={() => onChange(!checked)}
    >
      <span className="ds-switch-thumb" aria-hidden="true" />
    </button>
  );
}
