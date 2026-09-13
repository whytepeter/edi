import { useEffect, useState } from 'react';
import type { ModelOption } from '@edi/contracts';
import { Button, GroupedList, GroupedRow, Icon, TextField } from '../../components/ui';

const SHOWN = 60;

function price(model: ModelOption) {
  if (model.inputPrice === null) return 'Price unknown';
  if (model.inputPrice === 0) return 'Free';
  if (model.inputPrice < 0.5) return '$';
  if (model.inputPrice < 3) return '$$';
  return '$$$';
}

function context(tokens: number) {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M context`;
  return tokens > 0 ? `${Math.round(tokens / 1000)}K context` : '';
}

export const traits = (model: ModelOption) =>
  ['Vision', 'Tools', price(model), context(model.contextLength)].filter(Boolean).join(' · ');

interface ModelPickerProps {
  value: string;
  /** True once the choice is saved; false while it waits for the key. */
  saved: boolean;
  disabled?: boolean;
  onChange(id: string): void;
}

/**
 * OpenRouter models Edi can use, searchable. If the list can't load (offline), a model ID
 * can still be typed in.
 */
export function ModelPicker({ value, saved, disabled, onChange }: ModelPickerProps) {
  const [models, setModels] = useState<ModelOption[] | null>(null);
  const [failed, setFailed] = useState(!window.edi);
  const [query, setQuery] = useState('');
  const [manual, setManual] = useState(value);
  // The full list is for people who do not want Edi's recommendations.
  const [browsing, setBrowsing] = useState(false);

  useEffect(() => {
    if (!window.edi) return;
    let alive = true;
    window.edi
      .models()
      .then(list => alive && setModels(list))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const current = models?.find(model => model.id === value);
  const summary = (
    <GroupedList
      title="Model"
      footer="Only models that can see images and use tools are listed, since Edi needs both for screen questions and notes. Prices are per million input tokens: $ under $0.50, $$ under $3."
    >
      <GroupedRow
        icon="cpu"
        title={current?.name ?? (value || 'No model chosen')}
        detail={
          value
            ? `${saved ? 'In use' : 'Selected'} · ${current ? traits(current) : value}`
            : undefined
        }
      />
    </GroupedList>
  );

  if (failed)
    return (
      <div className="settings-form">
        {summary}
        <p className="ds-footnote ds-secondary">
          Couldn’t load OpenRouter’s model list. Type a model ID instead, such as
          provider/model-name.
        </p>
        <TextField
          label="Model ID"
          aria-label="OpenRouter model ID"
          placeholder="provider/model-name"
          value={manual}
          onChange={event => setManual(event.target.value)}
          maxLength={160}
          pattern="[a-zA-Z0-9_.:/\-]+"
        />
        <div className="settings-actions">
          <Button
            disabled={disabled || !/^[a-zA-Z0-9_.:/-]{3,160}$/.test(manual.trim())}
            onClick={() => onChange(manual.trim())}
          >
            Use this model
          </Button>
        </div>
      </div>
    );

  if (!models)
    return (
      <>
        {summary}
        <p role="status" className="ds-footnote ds-secondary">
          Loading models…
        </p>
      </>
    );

  const roles = {
    fast: 'Fast and affordable',
    balanced: 'Balanced',
    best: 'Most capable',
  } as const;
  const recommended = (['fast', 'balanced', 'best'] as const).flatMap(role =>
    models.filter(model => model.recommended === role),
  );
  const option = (model: ModelOption, label?: string) => (
    <button
      key={model.id}
      type="button"
      role="radio"
      aria-checked={model.id === value}
      disabled={disabled}
      className="model-option"
      onClick={() => onChange(model.id)}
    >
      <span className="model-option-text">
        {label && <span className="model-option-role">{label}</span>}
        <span className="model-option-name">{model.name}</span>
        <span className="model-option-traits">{traits(model)}</span>
      </span>
      {model.id === value && <Icon name="check" size={15} />}
    </button>
  );

  if (!browsing && recommended.length)
    return (
      <div className="model-picker">
        {summary}
        <div className="model-list" role="radiogroup" aria-label="Recommended models">
          {recommended.map(model => option(model, roles[model.recommended!]))}
        </div>
        <div className="settings-actions">
          <Button variant="plain" onClick={() => setBrowsing(true)}>
            Choose a different model
          </Button>
        </div>
      </div>
    );

  const needle = query.trim().toLowerCase();
  const matches = models.filter(model =>
    `${model.name} ${model.id}`.toLowerCase().includes(needle),
  );
  const shown = matches.slice(0, SHOWN);

  return (
    <div className="model-picker">
      {summary}
      {recommended.length > 0 && (
        <div className="settings-actions">
          <Button variant="plain" onClick={() => setBrowsing(false)}>
            Back to recommended
          </Button>
        </div>
      )}
      <TextField
        label="Search models"
        hideLabel
        icon="search"
        type="search"
        placeholder={`Search ${models.length} models`}
        value={query}
        onChange={event => setQuery(event.target.value)}
      />
      <div className="model-list" role="radiogroup" aria-label="Models">
        {shown.map(model => (
          <button
            key={model.id}
            type="button"
            role="radio"
            aria-checked={model.id === value}
            disabled={disabled}
            className="model-option"
            onClick={() => onChange(model.id)}
          >
            <span className="model-option-text">
              <span className="model-option-name">{model.name}</span>
              <span className="model-option-traits">{traits(model)}</span>
            </span>
            {model.id === value && <Icon name="check" size={15} />}
          </button>
        ))}
        {matches.length === 0 && (
          <p className="model-list-empty ds-footnote ds-tertiary">No models match “{query}”.</p>
        )}
      </div>
      {matches.length > SHOWN && (
        <p className="ds-footnote ds-tertiary">
          Showing {SHOWN} of {matches.length}. Search to narrow it down.
        </p>
      )}
    </div>
  );
}
