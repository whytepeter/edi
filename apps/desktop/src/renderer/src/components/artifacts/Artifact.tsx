import { useEffect, useState, type CSSProperties } from 'react';
import type { Artifact, ArtifactKind, ArtifactRef, ArtifactSummary } from '@edi/contracts';
import { useSettings } from '../../hooks/useSettings';
import { accentFor } from '../../lib/bridge';
import { Icon, IconButton, type IconName } from '../ui';
import { Markdown } from './Markdown';
import './artifacts.css';

const kindIcon: Record<ArtifactKind, IconName> = {
  document: 'notes',
  note: 'library',
  checklist: 'check',
  table: 'window',
  html: 'code',
};
const kindLabel: Record<ArtifactKind, string> = {
  document: 'Document',
  note: 'Note',
  checklist: 'Checklist',
  table: 'Table',
  html: 'Interactive',
};

/** Compact, inline form: in the conversation and in the bubble beside Edi. */
export function ArtifactCard({ artifact, onOpen }: { artifact: ArtifactSummary; onOpen(): void }) {
  return (
    <button
      type="button"
      className="artifact-card"
      onClick={onOpen}
      aria-label={`Open ${kindLabel[artifact.kind].toLowerCase()} “${artifact.title}”`}
    >
      <span className="artifact-card-icon">
        <Icon name={kindIcon[artifact.kind]} size={16} />
      </span>
      <span className="artifact-card-text">
        <span className="artifact-card-title">{artifact.title}</span>
        <span className="artifact-card-kind">{kindLabel[artifact.kind]}</span>
        {artifact.preview && <span className="artifact-card-preview">{artifact.preview}</span>}
      </span>
      <Icon name="chevron-right" size={14} />
    </button>
  );
}

/**
 * An interactive page never runs inside Edi's own document. Main serves it from Edi's history
 * over a private scheme with a sandboxing CSP, in a window session that refuses network access;
 * the frame adds `sandbox="allow-scripts"` so it has no origin, storage, pop-ups or dialogs.
 */
function InteractivePage({ reference, title }: { reference: ArtifactRef; title: string }) {
  if (!('callId' in reference)) return null;
  return (
    <iframe
      className="artifact-html"
      title={title}
      src={`edi-artifact://content/${reference.callId}`}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
    />
  );
}

function Body({ artifact, reference }: { artifact: Artifact; reference: ArtifactRef }) {
  if (artifact.kind === 'html')
    return <InteractivePage reference={reference} title={artifact.title} />;
  if (artifact.kind === 'checklist')
    return (
      <ul className="artifact-checklist">
        {artifact.items.map((item, index) => (
          <li key={index} data-done={item.done || undefined}>
            <span className="md-check" aria-hidden="true" />
            <span>{item.text}</span>
          </li>
        ))}
      </ul>
    );
  if (artifact.kind === 'table')
    return (
      <div className="md-table">
        <table>
          <thead>
            <tr>
              {artifact.columns.map((column, index) => (
                <th key={index}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {artifact.rows.map((row, r) => (
              <tr key={r}>
                {artifact.columns.map((_, c) => (
                  <td key={c}>{row[c] ?? ''}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  return <Markdown source={artifact.markdown} />;
}

/** Which actions make sense for each kind. Future kinds (images, HTML) may not copy as text. */
const canCopy: Record<ArtifactKind, boolean> = {
  document: true,
  note: true,
  checklist: true,
  table: true,
  html: true,
};
const canDownload: Record<ArtifactKind, boolean> = {
  document: true,
  note: true,
  checklist: true,
  table: true,
  html: true,
};

/**
 * Expanded form: its own window beside the card, like an artifact panel. The header carries
 * the title and the actions this content supports; Close (or Escape) dismisses it.
 */
export function ArtifactWindow({ initial }: { initial: ArtifactRef | null }) {
  const { settings } = useSettings();
  const [reference, setReference] = useState(initial);
  const key = reference ? ('callId' in reference ? reference.callId : reference.noteId) : '';
  // Results are tagged with the content they belong to, so switching content never shows
  // the previous title, error or "Copied" state.
  const [loaded, setLoaded] = useState<{ key: string; artifact?: Artifact; error?: string }>({
    key: '',
  });
  const [actionError, setActionError] = useState({ key: '', message: '' });
  const [copiedKey, setCopiedKey] = useState('');
  const artifact = loaded.key === key ? (loaded.artifact ?? null) : null;
  const error =
    (loaded.key === key ? loaded.error : '') ||
    (actionError.key === key ? actionError.message : '');
  const copied = copiedKey === key && key !== '';

  // The window is reused: main sends new content instead of opening another window.
  useEffect(() => window.edi?.onOpenArtifact(setReference), []);

  useEffect(() => {
    if (!window.edi || !reference) return;
    let alive = true;
    window.edi
      .artifact(reference)
      .then(value => alive && setLoaded({ key, artifact: value }))
      .catch(() => alive && setLoaded({ key, error: 'This content is no longer available.' }));
    return () => {
      alive = false;
    };
    // `key` identifies the reference; a new object for the same content need not reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopiedKey(''), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const close = () => void window.edi?.command({ type: 'close-artifact' });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const act = async (type: 'artifact-copy' | 'artifact-download' | 'artifact-reveal') => {
    if (!reference || !window.edi) return;
    try {
      setActionError({ key: '', message: '' });
      await window.edi.command({ type, ref: reference });
      if (type === 'artifact-copy') setCopiedKey(key);
    } catch {
      setActionError({
        key,
        message:
          type === 'artifact-reveal'
            ? 'Couldn’t find the saved file.'
            : type === 'artifact-copy'
              ? 'Couldn’t copy this.'
              : 'Couldn’t save a copy.',
      });
    }
  };

  const kind = artifact?.kind;
  return (
    <article
      className="artifact-window ds-card glass-window"
      data-accent
      style={{ '--accent': accentFor(settings.skin) } as CSSProperties}
      aria-label={artifact?.title ?? 'Content'}
    >
      <header className="artifact-window-header">
        <span className="artifact-card-icon" aria-hidden="true">
          <Icon name={kind ? kindIcon[kind] : 'notes'} size={16} />
        </span>
        <div className="artifact-window-title">
          <h1>{artifact?.title ?? (error ? 'Unavailable' : 'Loading…')}</h1>
          {kind && <span>{kindLabel[kind]}</span>}
        </div>
        <div className="artifact-window-actions">
          {kind && canCopy[kind] && (
            <IconButton
              icon={copied ? 'check' : 'copy'}
              label={copied ? 'Copied' : 'Copy'}
              data-done={copied || undefined}
              onClick={() => void act('artifact-copy')}
            />
          )}
          {kind && canDownload[kind] && (
            <IconButton
              icon="download"
              label="Download"
              onClick={() => void act('artifact-download')}
            />
          )}
          {artifact && (
            <IconButton
              icon="folder"
              label="Show in Finder"
              onClick={() => void act('artifact-reveal')}
            />
          )}
          <IconButton icon="close" label="Close" onClick={close} />
        </div>
      </header>
      <div className="artifact-window-body" data-kind={kind}>
        {error && (
          <p role="alert" className="artifact-window-error">
            {error}
          </p>
        )}
        {artifact && reference && <Body artifact={artifact} reference={reference} />}
      </div>
    </article>
  );
}
