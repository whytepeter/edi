import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoriesForPrompt, type Memory, type MemoryKind } from '@edi/contracts';
import { memoryCapabilities } from './index';

const context = {
  callId: '00000000-0000-4000-8000-000000000001',
  runId: '00000000-0000-4000-8000-000000000002',
};
const live = () => new AbortController().signal;

function setup(enabled = true) {
  const kept: Memory[] = [];
  let next = 0;
  const [remember, forget] = memoryCapabilities({
    list: () => kept,
    add: ({ kind, text }: { kind: MemoryKind; text: string }) => {
      const memory: Memory = {
        id: `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`,
        kind,
        text,
        createdAt: next,
        updatedAt: next,
      };
      kept.push(memory);
      return memory;
    },
    remove: (id: string) => {
      const at = kept.findIndex(memory => memory.id === id);
      if (at < 0) return false;
      kept.splice(at, 1);
      return true;
    },
    enabled: () => enabled,
  });
  const run = async (
    tool: typeof remember | typeof forget,
    input: unknown,
  ) => (await tool.prepare(input as never, context)).execute(live());
  return { kept, remember, forget, run };
}

test('remembering is reviewed, kept once, and listed for the next conversation', async () => {
  const { kept, remember, forget, run } = setup();
  const prepared = await remember.prepare(
    { text: 'Prefers short answers, no preamble', kind: 'preference' },
    context,
  );
  assert.equal(prepared.preview.action, 'Remember');
  assert.match(prepared.preview.summary, /^Remember: “Prefers short answers/);
  await prepared.execute(live());
  assert.deepEqual(
    kept.map(memory => memory.text),
    ['Prefers short answers, no preamble'],
  );

  // The same thing again is refused rather than kept twice.
  await assert.rejects(
    async () =>
      remember.prepare({ text: 'prefers short answers, no preamble', kind: 'preference' }, context),
    /already remembers that/,
  );

  await run(remember, { text: 'Works with Ada on the Nlockd app', kind: 'project' });
  assert.deepEqual(memoriesForPrompt(kept), [
    '- Prefers short answers, no preamble',
    '- Works with Ada on the Nlockd app',
  ]);

  const gone = await run(forget, { text: 'short answers' });
  assert.match(gone.summary, /^Forgotten: “Prefers short answers/);
  assert.deepEqual(
    kept.map(memory => memory.text),
    ['Works with Ada on the Nlockd app'],
  );
});

test('secrets are never kept, and forgetting says when it can’t tell which one', async () => {
  const { remember, forget, run } = setup();
  await assert.rejects(
    async () => remember.prepare({ text: 'My wifi password is hunter2', kind: 'fact' }, context),
    /doesn’t keep passwords/,
  );
  await assert.rejects(
    async () => forget.prepare({ text: 'anything' }, context),
    /doesn’t remember anything like/,
  );

  await run(remember, { text: 'Ada is the designer', kind: 'person' });
  await run(remember, { text: 'Ada prefers Figma links', kind: 'preference' });
  await assert.rejects(async () => forget.prepare({ text: 'Ada' }, context), /Several match “Ada”/);
});

test('with remembering switched off, Edi keeps nothing', async () => {
  const { remember } = setup(false);
  await assert.rejects(
    async () => remember.prepare({ text: 'Likes tables', kind: 'preference' }, context),
    /switched off remembering/,
  );
});
