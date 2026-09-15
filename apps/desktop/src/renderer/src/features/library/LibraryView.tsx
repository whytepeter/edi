import { useEffect, useState } from 'react';
import type { ArtifactRef, LibraryItem } from '@edi/contracts';
import { Button, EmptyState, GroupedList, Icon, IconButton } from '../../components/ui';
import './library.css';
import { useAssistantName } from '../../hooks/useAssistantName';

const icon = {
  note: 'notes',
  document: 'notes',
  checklist: 'check',
  table: 'window',
  diagram: 'chart',
  html: 'code',
} as const;
const label = {
  note: 'Note',
  document: 'Report',
  checklist: 'Checklist',
  table: 'Table',
  diagram: 'Diagram',
  html: 'Interactive',
} as const;

const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const size = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * Generated artifacts and saved notes in Edi's workspace folder. Opening either uses the same
 * structured content view as its conversation card.
 */
export function LibraryView({
  refreshKey,
  onOpen,
}: {
  refreshKey: string;
  onOpen(ref: ArtifactRef): void;
}) {
  const assistant = useAssistantName();
  // Outside Electron there is nothing saved to load.
  const [items, setItems] = useState<LibraryItem[] | null>(() => (window.edi ? null : []));
  const [error, setError] = useState('');
  // Delete asks inline before anything moves; the confirmation is the person's consent.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function moveToTrash(item: LibraryItem) {
    if (!window.edi) return;
    setDeleting(item.id);
    setError('');
    try {
      await window.edi.command({ type: 'library-delete', id: item.id });
      setItems(current => current?.filter(entry => entry.id !== item.id) ?? current);
      setConfirming(null);
    } catch {
      setError(`Couldn’t move “${item.title}” to the Trash.`);
    } finally {
      setDeleting(null);
    }
  }

  useEffect(() => {
    if (!window.edi) return;
    let alive = true;
    window.edi
      .library()
      .then(value => alive && setItems(value))
      .catch(() => alive && setError('Couldn’t load your Library.'));
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  return (
    <section>
      {error && (
        <p role="alert" className="workspace-error">
          {error}
        </p>
      )}
      {items?.length === 0 && (
        <EmptyState icon="library" title="Nothing saved yet.">
          <p className="ds-body ds-secondary">
            Ask {assistant} to make a report, checklist or table, or to save a note. It will show up
            here.
          </p>
        </EmptyState>
      )}
      {items && items.length > 0 && (
        <>
          <header className="view-header">
            <h1 className="ds-large-title">Your Edi workspace.</h1>
            <p className="ds-body ds-secondary">
              Everything here is a plain file in Documents › Edi on this Mac.
            </p>
          </header>
          <GroupedList title="In your Edi folder">
            {items.map(item =>
              confirming === item.id ? (
                <li
                  key={item.id}
                  className="library-confirm"
                  role="group"
                  aria-label="Confirm delete"
                >
                  <span className="library-confirm-text">
                    Move “{item.title}” to the Trash? You can put it back from the Trash in Finder.
                  </span>
                  <span className="library-confirm-actions">
                    <Button size="small" variant="plain" onClick={() => setConfirming(null)}>
                      Cancel
                    </Button>
                    <Button
                      size="small"
                      variant="prominent"
                      disabled={deleting === item.id}
                      onClick={() => void moveToTrash(item)}
                    >
                      Move to Trash
                    </Button>
                  </span>
                </li>
              ) : (
                <li key={item.id} className="library-row">
                  <button
                    type="button"
                    className="ds-group-row"
                    data-link
                    onClick={() =>
                      onOpen(item.kind === 'note' ? { noteId: item.id } : { callId: item.id })
                    }
                  >
                    <span className="ds-group-row-icon">
                      <Icon name={icon[item.kind]} size={16} />
                    </span>
                    <span className="ds-group-row-text">
                      <span className="ds-group-row-title">{item.title}</span>
                      <span className="ds-group-row-detail">
                        {label[item.kind]} · {date.format(item.createdAt)} · {size(item.bytes)}
                      </span>
                    </span>
                  </button>
                  <IconButton
                    icon="trash"
                    label={`Delete “${item.title}”`}
                    className="library-delete"
                    onClick={() => setConfirming(item.id)}
                  />
                </li>
              ),
            )}
          </GroupedList>
        </>
      )}
    </section>
  );
}
