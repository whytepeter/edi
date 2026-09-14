import { useState } from 'react';
import type { ConversationSummary } from '@edi/contracts';
import { Button, EmptyState, Icon, IconButton } from '../../components/ui';

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

  return (
    <div className="conversation-list" role="region" aria-label="Conversations">
      <Button variant="prominent" size="small" disabled={running} onClick={onNew}>
        <Icon name="compose" size={15} />
        New conversation
      </Button>
      {conversations === null ? (
        <p className="ds-footnote ds-secondary">Loading…</p>
      ) : conversations.length === 0 ? (
        <EmptyState icon="chat" title="No conversations yet.">
          <p className="ds-body ds-secondary">Your conversations will appear here.</p>
        </EmptyState>
      ) : (
        <ul className="conversation-items">
          {conversations.map(conversation => {
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
