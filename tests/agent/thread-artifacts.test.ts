import test from 'node:test';
import assert from 'node:assert/strict';
import {
  summarizeShown,
  threadArtifacts,
} from '../../apps/desktop/src/main/agent/thread-artifacts';

const shown = (id: string, runId: string, title: string) => ({
  id,
  runId,
  capability: 'workspace.show',
  input: { kind: 'document', title, markdown: `About ${title}.` },
  output: null,
});

test('a reply shows a card for what it made, with the title the content has now', () => {
  const calls = [shown('a', 'run-1', 'Trip plan'), shown('b', 'run-2', 'Budget')];
  const cards = threadArtifacts(
    {
      shown: () => calls,
      // The person renamed the first since; the second is as it was shown.
      artifact: id =>
        id === 'a'
          ? { id, content: { kind: 'document', title: 'Lisbon trip', markdown: 'Flights.' } }
          : { id, content: calls[1]!.input },
    },
    ['run-1', 'run-2'],
  );
  assert.deepEqual(
    cards.get('run-1')?.map(card => [card.id, card.kind, card.title]),
    [['a', 'document', 'Lisbon trip']],
  );
  assert.equal(cards.get('run-2')?.[0]?.title, 'Budget');
});

test('deleted content leaves the conversation; a note keeps its card; broken history is skipped', () => {
  const calls = [
    shown('gone', 'run-1', 'Deleted'),
    {
      id: 'n',
      runId: 'run-1',
      capability: 'notes.show',
      input: { id: 'note-7' },
      output: { title: 'Call the bank' },
    },
    // Stored before a format changed: no kind, no title.
    { id: 'bad', runId: 'run-1', capability: 'workspace.show', input: {}, output: null },
  ];
  const cards = threadArtifacts(
    { shown: () => calls, artifact: id => (id === 'bad' ? { id, content: {} } : undefined) },
    ['run-1'],
  );
  assert.deepEqual(cards.get('run-1'), [
    { id: 'n', kind: 'note', title: 'Call the bank', preview: '', noteId: 'note-7' },
  ]);
  assert.equal(
    summarizeShown({ id: 'x', capability: 'workspace.show', input: null, output: null }),
    null,
  );
});

test('a reply that showed many things keeps its latest six cards', () => {
  const calls = Array.from({ length: 9 }, (_, index) =>
    shown(`c${index}`, 'run-1', `Item ${index}`),
  );
  const cards = threadArtifacts(
    { shown: () => calls, artifact: id => ({ id, content: calls.find(c => c.id === id)!.input }) },
    ['run-1'],
  );
  assert.deepEqual(
    cards.get('run-1')?.map(card => card.id),
    ['c3', 'c4', 'c5', 'c6', 'c7', 'c8'],
  );
});
