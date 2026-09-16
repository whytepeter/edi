import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import {
  exportFormatLabel,
  exportFormats,
  groupLibraryByDate,
  libraryWhenFor,
  type ArtifactRef,
  type ExportFormat,
  type GroupWhen,
  type LibraryItem,
} from '@edi/contracts';
import {
  Button,
  EmptyState,
  GroupedList,
  Icon,
  IconButton,
  Menu,
  type MenuEntry,
} from '../../components/ui';
import { commandMessage } from '../../lib/command-message';
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

/*
 * Rows sit under a heading that already says roughly when ("Today", "Previous 7 Days", "July"),
 * so each one only has to add what the heading leaves out.
 */
const clock = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });
const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
const day = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const dayWithYear = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
/** A full date and time for the title attribute, so the exact moment is always one hover away. */
const exact = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' });

function whenLabel(createdAt: number, when: GroupWhen, now: number) {
  const how = when === 'mixed' ? libraryWhenFor(createdAt, now) : when;
  if (how === 'time') return clock.format(createdAt);
  if (how === 'weekday') return weekday.format(createdAt);
  const format =
    new Date(createdAt).getFullYear() === new Date(now).getFullYear() ? day : dayWithYear;
  return format.format(createdAt);
}

const size = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const refOf = (item: LibraryItem): ArtifactRef =>
  item.kind === 'note' ? { noteId: item.id } : { callId: item.id };

/** A row's menu and the More button it opened from, in window coordinates. */
interface OpenMenu {
  id: string;
  anchor: { top: number; bottom: number; right: number };
}
const GAP = 4;
const MARGIN = 8;

/**
 * Generated artifacts and saved notes in Edi's workspace folder. Opening either uses the same
 * structured content view as its conversation card. Each row's menu renames, pins, regenerates,
 * exports, reveals or trashes it; pinned items gather at the top.
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
  // Read once per load, so "Today" and "Previous 7 Days" can't shift under the reader mid-scroll.
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState('');
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  // Delete asks inline before anything moves; the confirmation is the person's consent.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [exported, setExported] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Under the More button when it fits, above it when that fits, else as high as the card allows:
  // placed from the menu's real height before it paints.
  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!menu || !element) return;
    const height = element.offsetHeight;
    const below = menu.anchor.bottom + GAP;
    const above = menu.anchor.top - GAP - height;
    const top =
      below + height <= window.innerHeight - MARGIN
        ? below
        : above >= MARGIN
          ? above
          : Math.max(MARGIN, window.innerHeight - MARGIN - height);
    element.style.top = `${top}px`;
    element.style.right = `${Math.max(MARGIN, window.innerWidth - menu.anchor.right)}px`;
    element.style.visibility = 'visible';
  }, [menu]);

  const reload = () =>
    window.edi
      ?.library()
      .then(setItems)
      .catch(() => setError('Couldn’t load your Library.'));

  useEffect(() => {
    if (!window.edi) return;
    let alive = true;
    window.edi
      .library()
      .then(value => {
        if (!alive) return;
        setNow(Date.now());
        setItems(value);
      })
      .catch(() => alive && setError('Couldn’t load your Library.'));
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  useEffect(() => {
    if (!exported) return;
    const timer = setTimeout(() => setExported(null), 8000);
    return () => clearTimeout(timer);
  }, [exported]);

  /** Run one row action; main's own words explain a failure. */
  async function act(item: LibraryItem, work: () => Promise<unknown>, failure: string) {
    setMenu(null);
    setBusy(item.id);
    setError('');
    try {
      await work();
      return true;
    } catch (cause) {
      setError(commandMessage(cause, failure));
      return false;
    } finally {
      setBusy(null);
    }
  }

  const moveToTrash = (item: LibraryItem) =>
    act(
      item,
      async () => {
        await window.edi!.command({ type: 'library-delete', id: item.id });
        setItems(current => current?.filter(entry => entry.id !== item.id) ?? current);
        setConfirming(null);
      },
      `Couldn’t move “${item.title}” to the Trash.`,
    );

  const rename = (event: FormEvent, item: LibraryItem) => {
    event.preventDefault();
    const title = renaming?.title.trim() ?? '';
    if (!title || title === item.title) return setRenaming(null);
    void act(
      item,
      async () => {
        await window.edi!.command({ type: 'library-rename', id: item.id, title });
        setRenaming(null);
        await reload();
      },
      `Couldn’t rename “${item.title}”.`,
    );
  };

  const exportAs = (item: LibraryItem, format: ExportFormat) =>
    act(
      item,
      async () => {
        const result = await window.edi!.exportArtifact(refOf(item), format);
        if (result) setExported(result.name);
      },
      `Couldn’t export “${item.title}”.`,
    );

  function openMenu(item: LibraryItem, button: HTMLElement) {
    if (menu?.id === item.id) return setMenu(null);
    const { top, bottom, right } = button.getBoundingClientRect();
    setMenu({ id: item.id, anchor: { top, bottom, right } });
  }

  function menuItems(item: LibraryItem): MenuEntry[] {
    return [
      {
        id: 'rename',
        label: 'Rename',
        icon: 'compose',
        onSelect: () => {
          setMenu(null);
          setRenaming({ id: item.id, title: item.title });
        },
      },
      {
        id: 'pin',
        label: item.pinned ? 'Unpin' : 'Pin to Top',
        icon: 'pin',
        onSelect: () =>
          void act(
            item,
            async () => {
              await window.edi!.command({ type: 'library-pin', id: item.id, pinned: !item.pinned });
              await reload();
            },
            `Couldn’t ${item.pinned ? 'unpin' : 'pin'} “${item.title}”.`,
          ),
      },
      ...(item.regenerable
        ? [
            {
              id: 'regenerate',
              label: 'Regenerate',
              icon: 'sparkles' as const,
              onSelect: () =>
                void act(
                  item,
                  () => window.edi!.command({ type: 'library-regenerate', id: item.id }),
                  `Couldn’t make “${item.title}” again.`,
                ),
            },
          ]
        : []),
      { separator: true },
      ...exportFormats[item.kind].map(format => ({
        id: `export-${format}`,
        label: `Export as ${exportFormatLabel[format]}`,
        onSelect: () => void exportAs(item, format),
      })),
      { separator: true },
      {
        id: 'reveal',
        label: 'Show in Finder',
        icon: 'folder',
        onSelect: () =>
          void act(
            item,
            () => window.edi!.command({ type: 'reveal-library-item', id: item.id }),
            `Couldn’t find “${item.title}” in Finder.`,
          ),
      },
      {
        id: 'trash',
        label: 'Move to Trash…',
        icon: 'trash',
        onSelect: () => {
          setMenu(null);
          setConfirming(item.id);
        },
      },
    ];
  }

  function row(item: LibraryItem, when: GroupWhen) {
    if (confirming === item.id)
      return (
        <li key={item.id} className="library-confirm" role="group" aria-label="Confirm delete">
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
              disabled={busy === item.id}
              onClick={() => void moveToTrash(item)}
            >
              Move to Trash
            </Button>
          </span>
        </li>
      );
    if (renaming?.id === item.id)
      return (
        <li key={item.id} className="library-rename">
          <form onSubmit={event => rename(event, item)}>
            <span className="ds-group-row-icon">
              <Icon name={icon[item.kind]} size={16} />
            </span>
            <input
              className="ds-input"
              aria-label={`New name for “${item.title}”`}
              value={renaming.title}
              maxLength={120}
              autoFocus
              onFocus={event => event.currentTarget.select()}
              onChange={event => setRenaming({ id: item.id, title: event.target.value })}
              onKeyDown={event => {
                if (event.key !== 'Escape') return;
                event.preventDefault();
                event.stopPropagation();
                setRenaming(null);
              }}
            />
            <Button size="small" variant="plain" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button size="small" variant="prominent" type="submit" disabled={busy === item.id}>
              Rename
            </Button>
          </form>
        </li>
      );
    return (
      <li key={item.id} className="library-row" data-busy={busy === item.id || undefined}>
        <button
          type="button"
          className="ds-group-row"
          data-link
          onClick={() => onOpen(refOf(item))}
        >
          <span className="ds-group-row-icon">
            <Icon name={icon[item.kind]} size={16} />
          </span>
          <span className="ds-group-row-text">
            <span className="ds-group-row-title">{item.title}</span>
            <span className="ds-group-row-detail" title={exact.format(item.createdAt)}>
              {label[item.kind]} · {whenLabel(item.createdAt, when, now)} · {size(item.bytes)}
            </span>
          </span>
        </button>
        <IconButton
          icon="more"
          label={`More for “${item.title}”`}
          className="library-more"
          aria-haspopup="menu"
          aria-expanded={menu?.id === item.id}
          data-open={menu?.id === item.id || undefined}
          onClick={event => openMenu(item, event.currentTarget)}
        />
      </li>
    );
  }

  const groups = groupLibraryByDate(items ?? [], now);
  const menuItem = menu && items?.find(item => item.id === menu.id);

  return (
    <section className="library-view">
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
          {exported && (
            <p role="status" className="library-status">
              <Icon name="check" size={14} />
              <span>Exported “{exported}” to Exports</span>
              <button
                type="button"
                onClick={() => void window.edi?.command({ type: 'reveal-export' })}
              >
                Show in Finder
              </button>
            </p>
          )}
          {groups.map(group => (
            <GroupedList key={group.key} title={group.title}>
              {group.items.map(item => row(item, group.when))}
            </GroupedList>
          ))}
        </>
      )}
      {menu && menuItem && (
        <>
          <button
            type="button"
            className="library-menu-dismiss"
            aria-label="Close menu"
            onClick={() => setMenu(null)}
          />
          <div ref={menuRef} className="library-menu">
            <Menu
              label={`Actions for “${menuItem.title}”`}
              items={menuItems(menuItem)}
              onDismiss={() => setMenu(null)}
            />
          </div>
        </>
      )}
    </section>
  );
}
