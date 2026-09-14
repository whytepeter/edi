import { useEffect, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import {
  assistantNameSchema,
  defaultCharacterId,
  type CharacterDescriptor,
  type CharacterInspection,
  type SkinId,
} from '@edi/contracts';
import { Button, Icon, TextField } from '../../components/ui';
import { CharacterArt } from '../../components/character/CharacterArt';
import { useAssistantName } from '../../hooks/useAssistantName';
import { characterById } from '../../hooks/useCharacters';
import { CharacterInstallSheet } from './CharacterInstallSheet';
import { MoodPreview } from './MoodPreview';
import './appearance.css';

interface AppearanceViewProps {
  skin: SkinId;
  scale: number;
  /** Built-in and installed characters. */
  characters: CharacterDescriptor[];
  /** The person's own name for their companion; null uses the character's name. */
  customName: string | null;
  onApply(skin: SkinId): void;
  /** Resolves true once saved; null returns to the character's own name. */
  onName(name: string | null): Promise<boolean>;
  /** `commit` is false while the slider moves and true once when it settles. */
  onScale(scale: number, commit: boolean): void;
}

/**
 * The character library: preview a character before applying it, add one from a .edichar file
 * (chosen, or dropped here), see it in every mood, and remove ones you installed. The name and
 * size apply to whichever character is showing. Voice and conversation are unaffected.
 */
export function AppearanceView({
  skin,
  scale,
  characters,
  customName,
  onApply,
  onName,
  onScale,
}: AppearanceViewProps) {
  const assistant = useAssistantName();
  const current = characterById(characters, skin);
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
  const [previewId, setPreviewId] = useState<SkinId>(skin);
  const preview = characterById(characters, previewId);
  const [hovered, setHovered] = useState<SkinId | null>(null);
  const [moods, setMoods] = useState(false);
  const [inspection, setInspection] = useState<CharacterInspection | null>(null);
  const [dropping, setDropping] = useState(false);
  const [message, setMessage] = useState('');
  // The dragged value, only while the slider moves; otherwise the saved scale.
  const [dragging, setDragging] = useState<number | null>(null);
  const size = dragging ?? scale;
  const frame = useRef(0);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // At most one resize per frame while dragging; saving happens once, on release.
  function slide(value: number) {
    setDragging(value);
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => onScale(value, false));
  }

  async function pick() {
    setMessage('');
    try {
      const result = await window.edi?.pickCharacterPackage();
      if (result) setInspection(result);
    } catch {
      setMessage('Couldn’t open that file.');
    }
  }

  async function drop(event: DragEvent) {
    event.preventDefault();
    setDropping(false);
    const file = [...event.dataTransfer.files].find(item =>
      item.name.toLowerCase().endsWith('.edichar'),
    );
    if (!file) return setMessage('Characters come as .edichar files.');
    setMessage('');
    try {
      const result = await window.edi?.inspectCharacterFile(file);
      if (result) setInspection(result);
    } catch {
      setMessage('Couldn’t read that file.');
    }
  }

  async function remove(character: CharacterDescriptor) {
    setMessage('');
    try {
      await window.edi?.command({ type: 'character-remove', id: character.manifest.id });
      setPreviewId(skin === character.manifest.id ? defaultCharacterId : skin);
      setMoods(false);
    } catch {
      setMessage(`Couldn’t remove ${character.manifest.name}.`);
    }
  }

  const choose = (id: SkinId) => {
    setPreviewId(id);
    setMoods(false);
  };

  return (
    <section
      className="appearance-view"
      onDragOver={event => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setDropping(true);
      }}
      onDragLeave={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false);
      }}
      onDrop={event => void drop(event)}
    >
      <header className="view-header">
        <h1 className="ds-large-title">Pick your little someone.</h1>
        <p className="ds-body ds-secondary">
          {customName ? `Same ${assistant}. A different face.` : 'A face, and a name if you like.'}
        </p>
      </header>
      <div className="avatar-grid">
        {characters.map(entry => {
          const id = entry.manifest.id;
          return (
            <button
              key={id}
              type="button"
              className="avatar-choice"
              aria-label={`${entry.manifest.name} avatar option`}
              aria-pressed={previewId === id}
              data-accent
              style={
                {
                  '--accent': entry.manifest.colors.accent,
                  color: entry.manifest.colors.outline,
                } as CSSProperties
              }
              onClick={() => choose(id)}
              onMouseEnter={() => setHovered(id)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(id)}
              onBlur={() => setHovered(null)}
            >
              <CharacterArt character={entry} expression={hovered === id ? 'happy' : 'idle'} />
              <span className="ds-headline">{entry.manifest.name}</span>
              <span className="ds-caption ds-tertiary">
                {skin === id ? `Your ${assistant}` : entry.builtIn ? 'Try a new look' : 'Installed'}
              </span>
              {previewId === id && (
                <i className="avatar-check">
                  <Icon name="check" size={12} />
                </i>
              )}
            </button>
          );
        })}
        <button type="button" className="avatar-add" onClick={() => void pick()}>
          <Icon name="plus" size={22} />
          <span className="ds-headline">Add</span>
          <span className="ds-caption ds-tertiary">A .edichar file</span>
        </button>
      </div>
      <Button
        className="appearance-apply"
        variant="prominent"
        block
        disabled={previewId === current.manifest.id}
        onClick={() => onApply(previewId)}
      >
        {previewId === current.manifest.id
          ? `This is your ${assistant}`
          : `Use ${preview.manifest.name}`}
      </Button>
      <div className="appearance-character-actions">
        <Button size="small" variant="plain" onClick={() => setMoods(open => !open)}>
          {moods ? 'Hide moods' : `See ${preview.manifest.name} in every mood`}
        </Button>
        {!preview.builtIn && (
          <Button size="small" variant="plain" onClick={() => void remove(preview)}>
            Remove {preview.manifest.name}
          </Button>
        )}
      </div>
      {!preview.builtIn && (
        <p className="appearance-credit ds-footnote ds-tertiary">
          {preview.manifest.name} {preview.manifest.version} by {preview.manifest.author.name} ·{' '}
          {preview.manifest.license}
        </p>
      )}
      {moods && <MoodPreview character={preview} />}
      {message && (
        <p className="appearance-message ds-footnote" role="alert">
          {message}
        </p>
      )}
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
          placeholder={current.manifest.name}
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
            ? `Leave empty to use the character’s name, ${current.manifest.name}.`
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
      {dropping && (
        <div className="appearance-drop" aria-hidden="true">
          <Icon name="plus" size={28} />
          <span className="ds-headline">Drop to check this character</span>
        </div>
      )}
      {inspection && (
        <CharacterInstallSheet
          inspection={inspection}
          onClose={() => setInspection(null)}
          onInstalled={id => {
            setInspection(null);
            choose(id);
          }}
        />
      )}
    </section>
  );
}
