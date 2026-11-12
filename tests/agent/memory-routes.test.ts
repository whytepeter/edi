import test from 'node:test';
import assert from 'node:assert/strict';
import type { Memory } from '../../packages/contracts/src/index';
import { memoryRoutes } from '../../apps/desktop/src/main/memory-routes';

function store() {
  let kept: Memory[] = [];
  let published = 0;
  const routes = memoryRoutes(
    {
      list: () => kept,
      add: memory => kept.push(memory),
      update: (id, change) => {
        kept = kept.map(memory =>
          memory.id === id ? { ...memory, text: change.text, updatedAt: change.at } : memory,
        );
      },
      remove: id => {
        kept = kept.filter(memory => memory.id !== id);
      },
      clear: () => {
        kept = [];
      },
    },
    () => (published += 1),
    () => 1_000,
  );
  return { routes, kept: () => kept, published: () => published };
}

test('a line typed in Settings is kept, trimmed, and shown at once', () => {
  const { routes, kept, published } = store();
  routes.add('preference', '  Prefers short answers  ');
  assert.equal(kept().length, 1);
  assert.deepEqual(
    { kind: kept()[0]!.kind, text: kept()[0]!.text, createdAt: kept()[0]!.createdAt },
    { kind: 'preference', text: 'Prefers short answers', createdAt: 1_000 },
  );
  assert.equal(published(), 1);
});

test('Settings refuses what Edi would refuse: secrets, blanks and what it already remembers', () => {
  const { routes, kept, published } = store();
  routes.add('fact', 'Lives in Lagos');
  assert.throws(() => routes.add('fact', 'My password is hunter2'), /password manager/);
  assert.throws(() => routes.add('fact', '   '), /Write what Edi should remember/);
  assert.throws(() => routes.add('fact', 'lives in lagos'), /already remembers/);
  // Editing a line into a secret is refused too, and the line stays as it was.
  assert.throws(() => routes.edit(kept()[0]!.id, 'Card number 4111 1111'), /password manager/);
  assert.equal(kept()[0]!.text, 'Lives in Lagos');
  // Nothing refused was announced as a change.
  assert.equal(published(), 1);
});

test('editing, removing and clearing each change the list and say so', () => {
  const { routes, kept, published } = store();
  routes.add('fact', 'Lives in Lagos');
  routes.add('person', 'Sister is Priya');
  const first = kept()[0]!.id;
  routes.edit(first, 'Lives in Abuja');
  assert.equal(kept()[0]!.text, 'Lives in Abuja');
  routes.remove(first);
  assert.deepEqual(
    kept().map(memory => memory.text),
    ['Sister is Priya'],
  );
  routes.clear();
  assert.equal(kept().length, 0);
  assert.equal(published(), 5);
});
