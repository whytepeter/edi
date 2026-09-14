import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { assistantNameSchema, skins, type SkinId } from '@edi/contracts';
import { Button, Icon, TextField } from '../../components/ui';
import { useAssistantName } from '../../hooks/useAssistantName';
import { accentFor, inkFor } from '../../lib/bridge';
import { Pet } from '../../components/Pet';
import './appearance.css';

interface AppearanceViewProps {
  skin: SkinId;
  scale: number;
  /** The person's own name for their companion; null uses the character's name. */
  customName: string | null;
  onApply(skin: SkinId): void;
  /** Resolves true once saved; null returns to the character's own name. */
  onName(name: string | null): Promise<boolean>;
  /** `commit` is false while the slider moves and true once when it settles. */
  onScale(scale: number, commit: boolean): void;
}

/**
 * Preview a character before applying it; size applies live. The name is the person's own, or
 * the character's until they give one. Voice and conversation are unaffected.
 */
export function AppearanceView({
  skin,
  scale,
  customName,
  onApply,
  onName,
  onScale,
}: AppearanceViewProps) {
  const assistant = useAssistantName();
  const characterName = skins.find(entry => entry.id === skin)?.name ?? 'Edi';
  const [draft, setDraft] = useState(customName ?? '');
  const [savingName, setSavingName] = useState(false);
  // A saved name arriving from main (or the agent renaming itself) replaces the field.
  const [savedName, setSavedName] = useState(customName);
  if (savedName !== customName) {
    setSavedName(customName);
    setDraft(customName ?? '');
  }
  const trimmed = draft.trim();
  const nameValid = trimmed === '' || assistantNameSchema.safeParse(trimmed).success;
  const nameChanged = (trimmed || null) !== customName;
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
        <p className="ds-body ds-secondary">
          {customName ? `Same ${assistant}. A different face.` : 'A face, and a name if you like.'}
        </p>
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
              {skin === entry.id ? `Your ${assistant}` : 'Try a new look'}
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
        {preview === skin ? `This is your ${assistant}` : `Use ${previewName}`}
      </Button>
      <form
        className="appearance-name"
        onSubmit={async event => {
          event.preventDefault();
          if (!nameValid || !nameChanged || savingName) return;
          setSavingName(true);
          await onName(trimmed || null);
          setSavingName(false);
        }}
      >
        <TextField
          label="Name"
          placeholder={characterName}
          value={draft}
          maxLength={24}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={!nameValid || undefined}
          onChange={event => setDraft(event.target.value)}
        />
        <Button type="submit" size="small" disabled={!nameValid || !nameChanged || savingName}>
          {savingName ? 'Saving…' : 'Save'}
        </Button>
        <p
          className="appearance-name-hint ds-footnote ds-tertiary"
          role={nameValid ? undefined : 'alert'}
        >
          {nameValid
            ? `Leave empty to use the character’s name, ${characterName}.`
            : 'Start with a letter. Letters, numbers, spaces, hyphens and apostrophes only.'}
        </p>
      </form>
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
