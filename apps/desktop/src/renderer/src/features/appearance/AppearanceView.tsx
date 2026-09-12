import { useState, type CSSProperties } from 'react';
import { skins, type SkinId } from '@edi/contracts';
import { Button, Icon } from '../../components/ui';
import { accentFor } from '../../lib/bridge';
import { Pet } from '../../components/Pet';
import './appearance.css';

/** Preview a skin before applying it; voice and conversation are unaffected. */
export function AppearanceView({ skin, onApply }: { skin: SkinId; onApply(skin: SkinId): void }) {
  const [preview, setPreview] = useState<SkinId>(skin);
  const previewName = skins.find(entry => entry.id === preview)!.name;
  return (
    <section>
      <header className="view-header">
        <p className="ds-eyebrow">Appearance</p>
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
            style={{ '--accent': accentFor(entry.id), color: accentFor(entry.id) } as CSSProperties}
            onClick={() => setPreview(entry.id)}
          >
            <Pet skin={entry.id} />
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
      <p className="view-footnote ds-footnote ds-tertiary">
        Your voice and conversations stay the same.
      </p>
    </section>
  );
}
