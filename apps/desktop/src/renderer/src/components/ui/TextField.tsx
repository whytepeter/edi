import { useId, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Icon, type IconName } from './Icon';

type Common = { label: string; hideLabel?: boolean; icon?: IconName };
type InputProps = Common & { multiline?: false } & InputHTMLAttributes<HTMLInputElement>;
type AreaProps = Common & { multiline: true } & TextareaHTMLAttributes<HTMLTextAreaElement>;

/** Filled text field with a visible (or visually hidden) label bound by id. */
export function TextField(props: InputProps | AreaProps) {
  const id = useId();
  const { label, hideLabel = false, icon } = props;
  return (
    <div className="ds-field">
      <label htmlFor={id} className={hideLabel ? 'ds-visually-hidden' : 'ds-field-label'}>
        {label}
      </label>
      <div className="ds-field-control">
        {icon && (
          <span className="ds-field-icon">
            <Icon name={icon} size={16} />
          </span>
        )}
        {props.multiline ? (
          <textarea id={id} className="ds-input" {...strip(props)} />
        ) : (
          <input
            id={id}
            className="ds-input"
            data-has-icon={icon ? '' : undefined}
            {...strip(props)}
          />
        )}
      </div>
    </div>
  );
}

function strip<T extends Common & { multiline?: boolean }>(props: T) {
  const { label: _label, hideLabel: _hide, icon: _icon, multiline: _multi, ...rest } = props;
  return rest;
}
