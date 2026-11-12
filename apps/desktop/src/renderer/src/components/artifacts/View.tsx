import { useState } from 'react';
import { viewAsk, type ViewBlock } from '@edi/contracts';
import { Button } from '../ui';

/**
 * A view: interface Edi generated for this answer, drawn by Edi's own components from plain
 * data. Figures, progress, charts, lists, choices, fields and buttons; a tap on a choice or
 * button asks Edi for the next step, carrying whatever the person typed into the fields.
 * Nothing here is HTML from the model, so a view can sit inside Edi's own windows.
 */
export function View({
  blocks,
  onAsk,
}: {
  blocks: readonly ViewBlock[];
  /** Sends the person's tap to Edi as their next message; absent where nothing can be asked. */
  onAsk?: (prompt: string) => Promise<void>;
}) {
  const [fields, setFields] = useState<Record<number, string>>({});
  const [asked, setAsked] = useState<string | null>(null);
  const [failed, setFailed] = useState('');

  const filled = () =>
    blocks.flatMap((block, index) =>
      block.type === 'input'
        ? [{ label: block.text ?? '', value: fields[index] ?? block.value ?? '' }]
        : [],
    );
  async function ask(block: ViewBlock, option: string | null, key: string) {
    if (!onAsk || asked) return;
    setAsked(key);
    setFailed('');
    try {
      await onAsk(viewAsk(block, option, filled()));
    } catch (error) {
      // Main's own reason ("Set up OpenRouter first."), without Electron's IPC wrapping.
      const reason =
        error instanceof Error
          ? error.message.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '')
          : '';
      setFailed(reason && reason.length <= 160 ? reason : 'That didn’t send. Try again.');
      setAsked(null);
    }
  }

  // Stats that follow one another sit side by side, like a row of figures on a dashboard.
  const groups: { stats: boolean; blocks: { block: ViewBlock; index: number }[] }[] = [];
  blocks.forEach((block, index) => {
    const last = groups.at(-1);
    if (block.type === 'stat' && last?.stats) last.blocks.push({ block, index });
    else groups.push({ stats: block.type === 'stat', blocks: [{ block, index }] });
  });

  return (
    <div className="view" data-asked={asked !== null || undefined}>
      {groups.map((group, g) =>
        group.stats ? (
          <div key={g} className="view-stats">
            {group.blocks.map(({ block, index }) => (
              <div key={index} className="view-stat">
                <span className="view-stat-label">{block.text}</span>
                <span className="view-stat-value">{block.value}</span>
                {block.detail && <span className="view-stat-detail">{block.detail}</span>}
              </div>
            ))}
          </div>
        ) : (
          group.blocks.map(({ block, index }) => (
            <Block
              key={index}
              block={block}
              value={fields[index] ?? block.value ?? ''}
              onChange={value => setFields(current => ({ ...current, [index]: value }))}
              canAsk={Boolean(onAsk)}
              asked={asked}
              onAsk={option => void ask(block, option, `${index}:${option ?? ''}`)}
              id={index}
            />
          ))
        ),
      )}
      {asked !== null && (
        <p className="view-note" role="status">
          Asked. The answer appears beside the character.
        </p>
      )}
      {failed && (
        <p className="view-note" role="alert">
          {failed}
        </p>
      )}
    </div>
  );
}

function Block({
  block,
  value,
  onChange,
  canAsk,
  asked,
  onAsk,
  id,
}: {
  block: ViewBlock;
  value: string;
  onChange(value: string): void;
  canAsk: boolean;
  asked: string | null;
  onAsk(option: string | null): void;
  id: number;
}) {
  const { type, text, items = [], values = [] } = block;
  if (type === 'heading') return <h3 className="view-heading">{text}</h3>;
  if (type === 'text') return <p className="view-text">{text}</p>;
  if (type === 'divider') return <hr className="view-divider" />;
  if (type === 'progress') {
    const share = Math.max(0, Math.min(1, values[0] ?? 0));
    return (
      <div className="view-progress">
        <div className="view-progress-top">
          <span>{text}</span>
          <span>{Math.round(share * 100)}%</span>
        </div>
        <div
          className="view-progress-track"
          role="progressbar"
          aria-label={text}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(share * 100)}
        >
          <i style={{ width: `${share * 100}%` }} />
        </div>
      </div>
    );
  }
  if (type === 'list')
    return (
      <div className="view-list">
        {text && <span className="view-label">{text}</span>}
        <ul>
          {items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      </div>
    );
  if (type === 'chart') return <Chart block={block} />;
  if (type === 'choice')
    return (
      <div className="view-choice" role="group" aria-label={text ?? 'Choose one'}>
        {text && <span className="view-label">{text}</span>}
        <div className="view-chips">
          {items.map((item, index) => (
            <button
              key={index}
              type="button"
              className="view-chip"
              disabled={!canAsk || asked !== null}
              data-picked={asked === `${id}:${item}` || undefined}
              onClick={() => onAsk(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
    );
  if (type === 'input')
    return (
      <label className="view-field">
        <span className="view-label">{text}</span>
        <input value={value} maxLength={400} onChange={event => onChange(event.target.value)} />
      </label>
    );
  return (
    <Button
      variant="prominent"
      block
      disabled={!canAsk || asked !== null}
      onClick={() => onAsk(null)}
    >
      {text}
    </Button>
  );
}

/** Small, legible charts from a handful of values: bars, a line, or a ring of shares. */
function Chart({ block }: { block: ViewBlock }) {
  const { items = [], values = [], style = 'bar', text } = block;
  const top = Math.max(...values, 0) || 1;
  const total = values.reduce((sum, value) => sum + value, 0) || 1;
  const figure = (value: number) =>
    Number.isInteger(value) ? String(value) : value.toFixed(Math.abs(value) < 10 ? 1 : 0);
  const summary = items.map((item, index) => `${item} ${figure(values[index] ?? 0)}`).join(', ');

  if (style === 'ring') {
    const radius = 38;
    const around = 2 * Math.PI * radius;
    // Where each share begins along the ring.
    const starts = values.map((_, index) =>
      values.slice(0, index).reduce((sum, value) => sum + (value / total) * around, 0),
    );
    return (
      <figure className="view-chart" aria-label={text ?? summary}>
        {text && <figcaption className="view-label">{text}</figcaption>}
        <div className="view-ring">
          <svg viewBox="0 0 100 100" role="img" aria-label={summary}>
            {values.map((value, index) => (
              <circle
                key={index}
                cx="50"
                cy="50"
                r={radius}
                fill="none"
                strokeWidth="14"
                stroke="var(--accent-fill)"
                strokeOpacity={1 - (index / Math.max(1, values.length)) * 0.75}
                strokeDasharray={`${Math.max(0, (value / total) * around - 1.5)} ${around}`}
                strokeDashoffset={-(starts[index] ?? 0)}
                transform="rotate(-90 50 50)"
              />
            ))}
          </svg>
          <ul className="view-legend">
            {items.map((item, index) => (
              <li key={index}>
                <i style={{ opacity: 1 - (index / Math.max(1, values.length)) * 0.75 }} />
                <span>{item}</span>
                <span>{Math.round(((values[index] ?? 0) / total) * 100)}%</span>
              </li>
            ))}
          </ul>
        </div>
      </figure>
    );
  }

  if (style === 'line') {
    const width = 300;
    const height = 96;
    const step = values.length > 1 ? width / (values.length - 1) : 0;
    const points = values.map((value, index) => ({
      x: values.length > 1 ? index * step : width / 2,
      y: height - 8 - (value / top) * (height - 20),
    }));
    const path = points
      .map((point, index) => `${index ? 'L' : 'M'}${point.x} ${point.y}`)
      .join(' ');
    return (
      <figure className="view-chart" aria-label={text ?? summary}>
        {text && <figcaption className="view-label">{text}</figcaption>}
        <svg
          className="view-line"
          viewBox={`-6 0 ${width + 12} ${height}`}
          role="img"
          aria-label={summary}
        >
          <path
            d={`${path} L${points.at(-1)?.x ?? 0} ${height} L${points[0]?.x ?? 0} ${height} Z`}
            fill="var(--accent-soft)"
          />
          <path
            d={path}
            fill="none"
            stroke="var(--accent-fill)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {points.map((point, index) => (
            <circle key={index} cx={point.x} cy={point.y} r="3.5" fill="var(--accent-fill)" />
          ))}
        </svg>
        <div className="view-line-labels">
          {items.map((item, index) => (
            <span key={index}>{item}</span>
          ))}
        </div>
      </figure>
    );
  }

  return (
    <figure className="view-chart" aria-label={text ?? summary}>
      {text && <figcaption className="view-label">{text}</figcaption>}
      <div className="view-bars" role="img" aria-label={summary}>
        {items.map((item, index) => (
          <div key={index} className="view-bar">
            <span>{item}</span>
            <span className="view-bar-track">
              <i style={{ width: `${((values[index] ?? 0) / top) * 100}%` }} />
            </span>
            <span>{figure(values[index] ?? 0)}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}
