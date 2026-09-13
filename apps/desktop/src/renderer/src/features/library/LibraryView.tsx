import { useEffect, useState } from 'react';
import type { ArtifactRef, LibraryItem } from '@edi/contracts';
import { EmptyState, GroupedList, GroupedRow } from '../../components/ui';

const icon = {
  note: 'notes',
  document: 'notes',
  checklist: 'check',
  table: 'window',
  html: 'code',
} as const;
const label = {
  note: 'Note',
  document: 'Report',
  checklist: 'Checklist',
  table: 'Table',
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
  // Outside Electron there is nothing saved to load.
  const [items, setItems] = useState<LibraryItem[] | null>(() => (window.edi ? null : []));
  const [error, setError] = useState('');

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
            Ask Edi to make a report, checklist or table, or to save a note. It will show up here.
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
            {items.map(item => (
              <GroupedRow
                key={item.id}
                icon={icon[item.kind]}
                title={item.title}
                detail={`${label[item.kind]} · ${date.format(item.createdAt)} · ${size(item.bytes)}`}
                onOpen={() =>
                  onOpen(item.kind === 'note' ? { noteId: item.id } : { callId: item.id })
                }
              />
            ))}
          </GroupedList>
        </>
      )}
    </section>
  );
}
