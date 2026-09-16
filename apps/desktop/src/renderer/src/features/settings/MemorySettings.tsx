import { useState } from 'react';
import { maxMemories, type Memory } from '@edi/contracts';
import { Button, GroupedList, GroupedRow, Switch } from '../../components/ui';
import { useMemories } from '../../hooks/useMemories';
import './settings.css';

const kindLabel: Record<Memory['kind'], string> = {
  preference: 'How you like things',
  fact: 'About you',
  person: 'Someone',
  project: 'A project',
};

/**
 * Settings → Memory: everything Edi keeps about the person, in the order it reads it back.
 * Each line can be rewritten or removed, and nothing is kept without them reviewing it first.
 */
export function MemorySettings({
  remember,
  onRemember,
}: {
  remember: boolean;
  onRemember(enabled: boolean): void;
}) {
  const memories = useMemories();
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [clearing, setClearing] = useState(false);

  const send: (command: Parameters<NonNullable<typeof window.edi>['command']>[0]) => Promise<void> =
    async command => {
      setError('');
      try {
        await window.edi?.command(command);
      } catch {
        setError('Couldn’t change that. Try again.');
      }
    };

  return (
    <div className="settings-page">
      {error && (
        <p role="alert" className="workspace-error">
          {error}
        </p>
      )}
      <GroupedList
        title="Memory"
        footer="Edi asks before it keeps anything, and uses what's here in every conversation. Passwords, keys and card numbers are never kept."
      >
        <GroupedRow
          icon="sparkles"
          title="Let Edi remember things"
          detail={`Up to ${maxMemories} short lines you can edit or remove`}
          control={
            <Switch
              label="Let Edi remember things"
              checked={remember}
              onChange={enabled => {
                onRemember(enabled);
              }}
            />
          }
        />
      </GroupedList>

      <GroupedList
        title={memories.length ? `What Edi remembers (${memories.length})` : 'What Edi remembers'}
        footer={
          memories.length
            ? 'Say “forget that” and Edi removes one, or edit it here.'
            : 'Nothing yet. Tell Edi something worth keeping, such as how you like answers written.'
        }
      >
        {memories.map(memory =>
          editing?.id === memory.id ? (
            <li key={memory.id} className="memory-edit">
              <input
                className="ds-field"
                aria-label="What Edi remembers"
                value={editing.text}
                maxLength={400}
                autoFocus
                onChange={event => setEditing({ id: memory.id, text: event.target.value })}
                onKeyDown={event => {
                  if (event.key === 'Escape') setEditing(null);
                }}
              />
              <span className="memory-actions">
                <Button size="small" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button
                  size="small"
                  variant="prominent"
                  disabled={!editing.text.trim()}
                  onClick={() => {
                    const text = editing.text.trim();
                    setEditing(null);
                    if (text && text !== memory.text)
                      void send({ type: 'edit-memory', id: memory.id, text });
                  }}
                >
                  Save
                </Button>
              </span>
            </li>
          ) : (
            <GroupedRow
              key={memory.id}
              icon="notes"
              title={memory.text}
              detail={kindLabel[memory.kind]}
              control={
                <span className="memory-actions">
                  <Button
                    size="small"
                    onClick={() => setEditing({ id: memory.id, text: memory.text })}
                  >
                    Edit
                  </Button>
                  <Button
                    size="small"
                    onClick={() => void send({ type: 'remove-memory', id: memory.id })}
                  >
                    Remove
                  </Button>
                </span>
              }
            />
          ),
        )}
        {memories.length > 0 &&
          (clearing ? (
            <GroupedRow
              icon="trash"
              title="Forget everything?"
              detail="Edi starts again with nothing about you"
              control={
                <span className="memory-actions">
                  <Button size="small" onClick={() => setClearing(false)}>
                    Keep
                  </Button>
                  <Button
                    size="small"
                    variant="prominent"
                    onClick={() => {
                      setClearing(false);
                      void send({ type: 'forget-everything' });
                    }}
                  >
                    Forget all
                  </Button>
                </span>
              }
            />
          ) : (
            <GroupedRow
              icon="trash"
              title="Forget everything"
              detail="Remove all of it at once"
              onOpen={() => setClearing(true)}
            />
          ))}
      </GroupedList>
    </div>
  );
}
