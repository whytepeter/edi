import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import {
  CapabilityBroker,
  defineCapability,
  notesCapabilities,
  slugify,
  type ApprovalGate,
  type Capability,
  type ToolCallRecorder,
} from './index';

function recorder() {
  const events: string[] = [];
  const sink: ToolCallRecorder = {
    created: call => events.push(`created:${call.status}`),
    decided: (_id, decision) => events.push(`decided:${decision}`),
    finished: (_id, outcome) => events.push(`finished:${outcome.status}`),
  };
  return { events, sink };
}

const gate = (decision: 'approved' | 'denied' | 'never'): ApprovalGate => ({
  request: (_request, signal) =>
    new Promise((resolve, reject) => {
      if (decision !== 'never') return resolve(decision);
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }),
});

/** A write that counts executions, so tests can prove an effect did not happen. */
function counter(effect: 'read' | 'write' = 'write', work = async () => {}) {
  const state = { executed: 0 };
  const capability = defineCapability({
    id: 'test.touch',
    title: 'Touch',
    description: 'Test capability',
    effect,
    timeoutMs: 200,
    input: z.object({ value: z.string() }).strict(),
    prepare: ({ value }) => ({
      preview: { title: 'Touch', action: 'Touch', summary: `Touch ${value}`, fields: [] },
      async execute() {
        await work();
        state.executed++;
        return { summary: 'Touched', output: { value } };
      },
    }),
  });
  return { state, capability: capability as Capability };
}

const run = '00000000-0000-4000-8000-000000000001';
const live = () => new AbortController().signal;

test('approved writes execute once and are recorded in order', async () => {
  const { state, capability } = counter();
  const log = recorder();
  const broker = new CapabilityBroker([capability], {
    approvals: gate('approved'),
    recorder: log.sink,
  });
  const outcome = await broker.invoke(run, 'test_touch', { value: 'a' }, live());
  assert.equal(outcome.status, 'succeeded');
  assert.deepEqual(outcome.output, { value: 'a' });
  assert.equal(state.executed, 1);
  assert.deepEqual(log.events, [
    'created:awaiting-approval',
    'decided:approved',
    'finished:succeeded',
  ]);
});

test('denied writes never execute', async () => {
  const { state, capability } = counter();
  const broker = new CapabilityBroker([capability], {
    approvals: gate('denied'),
    recorder: recorder().sink,
  });
  assert.equal((await broker.invoke(run, 'test_touch', { value: 'a' }, live())).status, 'denied');
  assert.equal(state.executed, 0);
});

test('Stop while awaiting approval cancels without executing', async () => {
  const { state, capability } = counter();
  const log = recorder();
  const broker = new CapabilityBroker([capability], {
    approvals: gate('never'),
    recorder: log.sink,
  });
  const controller = new AbortController();
  const pending = broker.invoke(run, 'test_touch', { value: 'a' }, controller.signal);
  controller.abort();
  assert.equal((await pending).status, 'cancelled');
  assert.equal(state.executed, 0);
  assert.deepEqual(log.events, ['created:awaiting-approval', 'finished:cancelled']);
});

test('Stop between approval and execution still prevents the effect', async () => {
  const { state, capability } = counter();
  const controller = new AbortController();
  const approvals: ApprovalGate = {
    request: async () => {
      controller.abort(); // the user pressed Stop as they approved
      return 'approved';
    },
  };
  const broker = new CapabilityBroker([capability], { approvals, recorder: recorder().sink });
  assert.equal(
    (await broker.invoke(run, 'test_touch', { value: 'a' }, controller.signal)).status,
    'cancelled',
  );
  assert.equal(state.executed, 0);
});

test('reads skip approval; invalid input and unknown tools fail without effects', async () => {
  const { state, capability } = counter('read');
  const log = recorder();
  const broker = new CapabilityBroker([capability], {
    approvals: gate('never'),
    recorder: log.sink,
  });
  assert.equal(
    (await broker.invoke(run, 'test_touch', { value: 'a' }, live())).status,
    'succeeded',
  );
  assert.equal((await broker.invoke(run, 'test_touch', { value: 1 }, live())).status, 'failed');
  assert.equal((await broker.invoke(run, 'missing_tool', {}, live())).status, 'failed');
  assert.equal(state.executed, 1);
  assert.deepEqual(log.events, [
    'created:running',
    'finished:succeeded',
    'created:running',
    'finished:failed',
  ]);
});

test('a write that exceeds its deadline is unknown, never failed', async () => {
  const { capability } = counter('write', () => new Promise(resolve => setTimeout(resolve, 1000)));
  const broker = new CapabilityBroker([capability], {
    approvals: gate('approved'),
    recorder: recorder().sink,
  });
  const outcome = await broker.invoke(run, 'test_touch', { value: 'a' }, live());
  assert.equal(outcome.status, 'unknown');
  assert.match(outcome.summary, /check before retrying/);
});

test('writes are serialized: the second waits for the first', async () => {
  const order: string[] = [];
  let release!: () => void;
  const { capability } = counter('write', async () => {
    order.push('start');
    if (order.length === 1) await new Promise<void>(resolve => (release = resolve));
    order.push('end');
  });
  const broker = new CapabilityBroker([capability], {
    approvals: gate('approved'),
    recorder: recorder().sink,
  });
  const first = broker.invoke(run, 'test_touch', { value: 'a' }, live());
  const second = broker.invoke(run, 'test_touch', { value: 'b' }, live());
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(order, ['start']);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['start', 'end', 'start', 'end']);
});

test('manifest exposes model-safe names and JSON schemas', () => {
  const [save, list] = notesCapabilities({
    directory: () => '/tmp',
    store: { add() {}, list: () => [] },
  });
  const broker = new CapabilityBroker([save as Capability, list as Capability], {
    approvals: gate('never'),
    recorder: recorder().sink,
  });
  const manifest = broker.manifest();
  assert.deepEqual(
    manifest.map(entry => entry.name),
    ['notes_save', 'notes_list'],
  );
  assert.equal((manifest[0].inputSchema as { type: string }).type, 'object');
});

test('slugs cannot escape the folder', () => {
  assert.equal(slugify('../../etc/passwd'), 'etc-passwd');
  assert.equal(slugify('Café  Plans!'), 'cafe-plans');
  assert.equal(slugify('///'), '');
});

test('notes.save previews the exact path, writes it, and never overwrites', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'edi-notes-'));
  const saved: string[] = [];
  const [save] = notesCapabilities({
    directory: () => folder,
    store: { add: note => saved.push(note.path), list: () => [] },
  });
  await writeFile(join(folder, 'groceries.md'), 'existing');
  const context = { callId: '00000000-0000-4000-8000-000000000010', runId: run };

  const action = await save.prepare({ title: 'Groceries', body: '- milk' }, context);
  const location = action.preview.fields.find(field => field.label === 'Location')?.value;
  assert.equal(location, join(folder, 'groceries-2.md'));
  const result = await action.execute(live());
  assert.equal(await readFile(join(folder, 'groceries-2.md'), 'utf8'), '# Groceries\n\n- milk\n');
  assert.equal(await readFile(join(folder, 'groceries.md'), 'utf8'), 'existing');
  assert.deepEqual(result.output, { path: location });
  assert.deepEqual(saved, [location]);

  // The name was free at review but taken before execution: refuse, replace nothing.
  const raced = await save.prepare({ title: 'Race', body: 'b' }, context);
  await writeFile(join(folder, 'race.md'), 'someone else');
  await assert.rejects(raced.execute(live()), /Nothing was replaced/);
  assert.equal(await readFile(join(folder, 'race.md'), 'utf8'), 'someone else');
  assert.equal(
    (await readdir(folder)).some(name => name.endsWith('.tmp')),
    false,
  );
});
