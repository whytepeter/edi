import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { skins, type SkinId } from '@edi/contracts';
import { Button, Icon } from '../../components/ui';
import { accentFor, inkFor } from '../../lib/bridge';
import { Pet } from '../../components/Pet';
import './appearance.css';

interface AppearanceViewProps {
  skin: SkinId;
  scale: number;
  onApply(skin: SkinId): void;
  /** `commit` is false while the slider moves and true once when it settles. */
  onScale(scale: number, commit: boolean): void;
}

/** Preview a character before applying it; size applies live. Voice and conversation are unaffected. */
export function AppearanceView({ skin, scale, onApply, onScale }: AppearanceViewProps) {
  const [preview, setPreview] = useState<SkinId>(skin);
  const [hovered, setHovered] = useState<SkinId | null>(null);
  // The dragged value, only while the slider moves; otherwise the saved scale.
  const [dragging, setDragging] = useState<number | null>(null);
  const size = dragging ?? scale;
  const frame = useRef(0);
  const previewName = skins.find(entry => entry.id === preview)?.name ?? 'Edi';

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // At most one resize per frame while dragging; saving happens once, on release.
  function slide(value: number) {
    setDragging(value);
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => onScale(value, false));
  }

  return (
    <section>
      <header className="view-header">
        <h1 className="ds-large-title">Pick your little someone.</h1>
        <p className="ds-body ds-secondary">Same Edi. A different face.</p>
      </header>
      <div className="avatar-grid">
        {skins.map(entry => (
          <button
            key={entry.id}
            type="button"
            className="avatar-choice"
            aria-label={`${entry.name} avatar option`}
            aria-pressed={preview === entry.id}
            data-accent
            style={{ '--accent': accentFor(entry.id), color: inkFor(entry.id) } as CSSProperties}
            onClick={() => setPreview(entry.id)}
            onMouseEnter={() => setHovered(entry.id)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(entry.id)}
            onBlur={() => setHovered(null)}
          >
            <Pet skin={entry.id} expression={hovered === entry.id ? 'happy' : 'idle'} />
            <span className="ds-headline">{entry.name}</span>
            <span className="ds-caption ds-tertiary">
              {skin === entry.id ? 'Your Edi' : 'Try a new look'}
            </span>
            {preview === entry.id && (
              <i className="avatar-check">
                <Icon name="check" size={12} />
              </i>
            )}
          </button>
        ))}
      </div>
      <Button
        className="appearance-apply"
        variant="prominent"
        block
        disabled={preview === skin}
        onClick={() => onApply(preview)}
      >
        {preview === skin ? 'This is your Edi' : `Use ${previewName}`}
      </Button>
      <div className="appearance-size">
        <label className="ds-headline" htmlFor="appearance-size">
          Size on your desktop
        </label>
        <div className="appearance-size-control">
          <Icon name="face" size={13} />
          <input
            id="appearance-size"
            className="ds-range"
            type="range"
            min={0.6}
            max={1.6}
            step={0.05}
            value={size}
            aria-valuetext={`${Math.round(size * 100)}%`}
            onChange={event => slide(Number(event.target.value))}
            onPointerUp={() => {
              onScale(size, true);
              setDragging(null);
            }}
            onKeyUp={() => {
              onScale(size, true);
              setDragging(null);
            }}
          />
          <Icon name="face" size={20} />
        </div>
      </div>
      <p className="view-footnote ds-footnote ds-tertiary">
        Your voice and conversations stay the same.
      </p>
    </section>
  );
}
