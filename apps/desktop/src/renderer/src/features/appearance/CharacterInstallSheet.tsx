import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { CharacterInspection } from '@edi/contracts';
import { Button } from '../../components/ui';
import { MoodPreview } from './MoodPreview';

/**
 * What a package holds before anything is installed: who made it, every mood it has, and any
 * problems the check found. Errors block installing; warnings explain what was left out.
 */
export function CharacterInstallSheet({
  inspection,
  onClose,
  onInstalled,
}: {
  inspection: CharacterInspection;
  onClose(): void;
  onInstalled(id: string): void;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState('');
  const { character, manifest, problems, replaces } = inspection;
  const errors = problems.filter(problem => problem.level === 'error');
  const warnings = problems.filter(problem => problem.level === 'warning');

  useEffect(() => sheet.current?.focus(), []);

  async function install() {
    if (!character) return;
    setInstalling(true);
    setError('');
    try {
      await window.edi?.command({ type: 'character-install', token: inspection.token });
      onInstalled(character.manifest.id);
    } catch {
      setError('Couldn’t install this character. Try choosing the file again.');
      setInstalling(false);
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    if (!installing) onClose();
  }

  const name = manifest?.name ?? inspection.fileName;
  return (
    <div className="character-sheet-scrim">
      <div
        ref={sheet}
        className="character-sheet ds-glass"
        role="dialog"
        aria-modal="true"
        aria-label={`Add ${name}`}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <p className="ds-eyebrow">{character ? 'Ready to add' : 'Can’t add this character'}</p>
        <h2 className="ds-title">{name}</h2>
        {character && (
          <p className="ds-callout ds-secondary">
            {[
              character.manifest.description,
              `Version ${character.manifest.version} by ${character.manifest.author.name}`,
              character.manifest.license,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}
        {character && <MoodPreview character={character} />}
        {errors.length > 0 && (
          <ul className="character-problems" data-level="error">
            {errors.map(problem => (
              <li key={problem.message}>{problem.message}</li>
            ))}
          </ul>
        )}
        {warnings.length > 0 && (
          <details className="character-problems" data-level="warning">
            <summary className="ds-footnote">
              {warnings.length === 1
                ? '1 note from the check'
                : `${warnings.length} notes from the check`}
            </summary>
            <ul>
              {warnings.map(problem => (
                <li key={problem.message}>{problem.message}</li>
              ))}
            </ul>
          </details>
        )}
        <p className="ds-footnote ds-tertiary">
          Characters are pictures only: they can’t run code, reach the internet or see your data.
        </p>
        {error && (
          <p role="alert" className="character-sheet-error">
            {error}
          </p>
        )}
        <div className="character-sheet-actions">
          <Button disabled={installing} onClick={onClose}>
            {character ? 'Cancel' : 'Close'}
          </Button>
          {character && (
            <Button variant="prominent" disabled={installing} onClick={() => void install()}>
              {installing ? 'Adding…' : replaces ? `Update from ${replaces}` : 'Add Character'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
