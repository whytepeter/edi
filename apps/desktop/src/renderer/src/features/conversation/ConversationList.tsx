import { useEffect, useState } from 'react';
import type { ConversationSummary } from '@edi/contracts';
import { Button, EmptyState, Icon, IconButton, TextField } from '../../components/ui';

function when(at: number, now = Date.now()) {
  const date = new Date(at);
  const today = new Date(now);
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (date.toDateString() === today.toDateString()) return `Today, ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/** Saved conversations, most recent first: open one, start a new one, or delete one. */
export function ConversationList({
  conversations,
  currentId,
  running,
  onOpen,
  onNew,
  onDelete,
}: {
  conversations: ConversationSummary[] | null;
  currentId: string | null;
  running: boolean;
  onOpen(id: string): void;
  onNew(): void;
  onDelete(id: string): void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<ConversationSummary[] | null>(null);
  const searching = query.trim().length > 0;

  // Search every turn of every conversation, a moment after typing stops.
  useEffect(() => {
    if (!searching) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      void window.edi
        ?.conversations(query)
        .then(found => alive && setMatches(found))
        .catch(() => alive && setMatches([]));
    }, 160);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [query, searching, conversations]);
  const shown = searching ? matches : conversations;

  return (
    <div className="conversation-list" role="region" aria-label="Conversations">
      <Button variant="prominent" size="small" disabled={running} onClick={onNew}>
        <Icon name="compose" size={15} />
        New conversation
      </Button>
      {(conversations?.length ?? 0) > 0 && (
        <TextField
          label="Search conversations"
          hideLabel
          icon="search"
          placeholder="Search conversations"
          value={query}
          maxLength={200}
          onChange={event => setQuery(event.target.value)}
        />
      )}
      {shown === null ? (
        <p className="ds-footnote ds-secondary">{searching ? 'Searching…' : 'Loading…'}</p>
      ) : searching && shown.length === 0 ? (
        <p className="ds-footnote ds-secondary conversation-no-match">
          No conversations mention “{query.trim()}”.
        </p>
      ) : shown.length === 0 ? (
        <EmptyState icon="chat" title="No conversations yet.">
          <p className="ds-body ds-secondary">Your conversations will appear here.</p>
        </EmptyState>
      ) : (
        <ul className="conversation-items">
          {shown.map(conversation => {
            const current = conversation.id === currentId;
            return (
              <li
                key={conversation.id}
                className="conversation-item"
                data-current={current || undefined}
              >
                {confirming === conversation.id ? (
                  <div
                    className="conversation-confirm"
                    role="group"
                    aria-label="Delete conversation"
                  >
                    <span className="ds-callout">Delete “{conversation.title}”?</span>
                    <span className="conversation-confirm-actions">
                      <Button size="small" onClick={() => setConfirming(null)}>
                        Cancel
                      </Button>
                      <Button
                        size="small"
                        variant="prominent"
                        onClick={() => {
                          setConfirming(null);
                          onDelete(conversation.id);
                        }}
                      >
                        Delete
                      </Button>
                    </span>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      className="conversation-open"
                      aria-current={current || undefined}
                      disabled={running && !current}
                      onClick={() => onOpen(conversation.id)}
                    >
                      <span className="conversation-title">{conversation.title}</span>
                      {conversation.excerpt && (
                        <span className="conversation-excerpt">{conversation.excerpt}</span>
                      )}
                      <span className="conversation-detail">
                        {when(conversation.updatedAt)} · {conversation.turns}{' '}
                        {conversation.turns === 1 ? 'question' : 'questions'}
                      </span>
                    </button>
                    <IconButton
                      icon="trash"
                      label={`Delete ${conversation.title}`}
                      className="conversation-delete"
                      disabled={running && current}
                      onClick={() => setConfirming(conversation.id)}
                    />
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
