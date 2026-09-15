import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { artifactExport, type ArtifactSummary } from '@edi/contracts';
import {
  CapabilityBroker,
  defineCapability,
  ediSetupCapabilities,
  notesCapabilities,
  slugify,
  workspaceCapabilities,
  writeWorkspaceArtifact,
  type ApprovalGate,
  type ArtifactStore,
  type Capability,
  type WorkspaceArtifact,
  type ListedNote,
  type NoteStore,
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
const noteId = '00000000-0000-4000-8000-000000000020';

function emptyStore(): NoteStore {
  return { add() {}, get: () => undefined, list: () => [], update() {}, remove() {} };
}

function memoryArtifacts(): ArtifactStore & { records: WorkspaceArtifact[] } {
  const records: WorkspaceArtifact[] = [];
  return {
    records,
    add: record => void records.unshift(record),
    get: id => records.find(record => record.id === id),
    list: limit => [...records].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit),
    update(change) {
      const current = records.find(record => record.id === change.id);
      if (!current) throw new Error('missing');
      Object.assign(current, change);
    },
    remove(id) {
      const index = records.findIndex(record => record.id === id);
      if (index < 0) throw new Error('missing');
      records.splice(index, 1);
    },
  };
}

function memoryStore(seed: ListedNote[] = []): NoteStore & { records: ListedNote[] } {
  const records = [...seed];
  return {
    records,
    add(note) {
      records.unshift({
        id: note.id,
        title: note.title,
        path: note.path,
        createdAt: note.createdAt,
      });
    },
    get(id) {
      return records.find(note => note.id === id);
    },
    list(limit) {
      return records.slice(0, limit);
    },
    update(note) {
      const current = records.find(entry => entry.id === note.id);
      if (!current) throw new Error('missing');
      current.title = note.title;
    },
    remove(id) {
      const index = records.findIndex(entry => entry.id === id);
      if (index < 0) throw new Error('missing');
      records.splice(index, 1);
    },
  };
}

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
  const capabilities = notesCapabilities({
    directory: () => '/tmp',
    store: emptyStore(),
  });
  const broker = new CapabilityBroker([...capabilities], {
    approvals: gate('never'),
    recorder: recorder().sink,
  });
  const manifest = broker.manifest();
  assert.deepEqual(
    manifest.map(entry => entry.name),
    ['notes_save', 'notes_show'],
  );
  assert.ok(manifest[0]);
  assert.equal((manifest[0].inputSchema as { type: string }).type, 'object');
});

test('slugs cannot escape the folder', () => {
  assert.equal(slugify('../../etc/passwd'), 'etc-passwd');
  assert.equal(slugify('Café  Plans!'), 'cafe-plans');
  assert.equal(slugify('///'), '');
});

test('notes.save previews the exact path, writes it, and never overwrites', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'edi-notes-'));
  const store = memoryStore();
  const [save] = notesCapabilities({
    directory: () => folder,
    store,
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
  assert.deepEqual(
    store.records.map(note => note.path),
    [location],
  );

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

/** Workspace tools over a notes folder, recording what was shown and trashed. */
function notesWorkspace(folder: string, store: NoteStore) {
  const shown: ArtifactSummary[] = [];
  const trashed: string[] = [];
  const tools = workspaceCapabilities({
    directory: () => folder,
    shown: artifact => {
      shown.push(artifact);
    },
    artifacts: memoryArtifacts(),
    notes: { store, directory: () => folder },
    trash: async path => {
      trashed.push(path);
      await rm(path);
    },
  });
  const [, , read, update, remove] = tools;
  return { read, update, remove, shown, trashed };
}

test('saved notes are read, edited and trashed through the workspace tools', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'edi-notes-'));
  const path = join(folder, 'ideas.md');
  await writeFile(path, '# Ideas\n\nold\n');
  const store = memoryStore([{ id: noteId, title: 'Ideas', path, createdAt: 1 }]);
  const { read, update, remove, shown, trashed } = notesWorkspace(folder, store);
  const context = { callId: '00000000-0000-4000-8000-000000000011', runId: run };

  const reading = await read.prepare({ id: noteId }, context);
  assert.deepEqual((await reading.execute(live())).output, {
    id: noteId,
    kind: 'note',
    title: 'Ideas',
    text: '# Ideas\n\nold\n',
  });

  const editing = await update.prepare(
    { id: noteId, kind: 'note', title: 'Plans', markdown: 'new' },
    context,
  );
  assert.equal(editing.preview.fields.find(field => field.label === 'Location')?.value, path);
  assert.equal(editing.preview.fields[0]?.value, 'Ideas → Plans');
  await editing.execute(live());
  assert.equal(await readFile(path, 'utf8'), '# Plans\n\nnew\n');
  assert.equal(store.records[0]?.title, 'Plans');
  assert.deepEqual(
    shown.map(item => [item.kind, item.title, item.noteId]),
    [['note', 'Plans', noteId]],
  );
  // A note is edited as a note, never turned into a checklist.
  await assert.rejects(
    async () => update.prepare({ id: noteId, kind: 'checklist', title: 'X', items: [] }, context),
    /That item is a note/,
  );

  const trashing = await remove.prepare({ id: noteId }, context);
  await trashing.execute(live());
  assert.deepEqual(trashed, [path]);
  assert.deepEqual(store.records, []);
  assert.equal(
    (await readdir(folder)).some(name => name.endsWith('.tmp')),
    false,
  );
});

test('workspace tools refuse notes outside the notes folder', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'edi-notes-'));
  const outside = join(tmpdir(), `edi-notes-outside-${noteId}.md`);
  await writeFile(outside, 'secret');
  const store = memoryStore([{ id: noteId, title: 'Secret', path: outside, createdAt: 1 }]);
  const { read, update, remove } = notesWorkspace(folder, store);
  const context = { callId: '00000000-0000-4000-8000-000000000012', runId: run };

  const reading = await read.prepare({ id: noteId }, context);
  await assert.rejects(reading.execute(live()), /outside the notes folder/);
  await assert.rejects(
    async () => update.prepare({ id: noteId, kind: 'note', title: 'X', markdown: 'y' }, context),
    /outside the notes folder/,
  );
  await assert.rejects(
    async () => remove.prepare({ id: noteId }, context),
    /outside the notes folder/,
  );
  assert.equal(await readFile(outside, 'utf8'), 'secret');
});

test('reading a note refuses replacement links and oversized files', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'edi-notes-'));
  const outside = join(folder, '..', `edi-secret-${noteId}.md`);
  const linked = join(folder, 'linked.md');
  await writeFile(outside, 'secret');
  await symlink(outside, linked);
  const context = { callId: '00000000-0000-4000-8000-000000000013', runId: run };
  const linkedTools = notesWorkspace(
    folder,
    memoryStore([{ id: noteId, title: 'Linked', path: linked, createdAt: 1 }]),
  );
  const linkedAction = await linkedTools.read.prepare({ id: noteId }, context);
  await assert.rejects(() => linkedAction.execute(live()));

  const large = join(folder, 'large.md');
  await writeFile(large, 'x'.repeat(64 * 1024 + 1));
  const largeTools = notesWorkspace(
    folder,
    memoryStore([{ id: noteId, title: 'Large', path: large, createdAt: 1 }]),
  );
  const largeAction = await largeTools.read.prepare({ id: noteId }, context);
  await assert.rejects(() => largeAction.execute(live()), /too large/);
});

test('notes.show displays a note without returning its text to the model', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'edi-notes-'));
  const path = join(folder, 'groceries.md');
  await writeFile(path, '# Groceries\n\n- milk\n- eggs\n');
  const store = memoryStore([{ id: noteId, title: 'Groceries', path, createdAt: 1 }]);
  const shown: unknown[] = [];
  const show = notesCapabilities({ directory: () => folder, store, shown: a => shown.push(a) })[1];
  const callId = '00000000-0000-4000-8000-000000000020';
  const result = await (await show.prepare({ id: noteId }, { callId, runId: run })).execute(live());
  assert.deepEqual(result.output, { shown: true, title: 'Groceries' });
  assert.deepEqual(shown, [
    { id: callId, kind: 'note', title: 'Groceries', preview: 'Groceries\n• milk\n• eggs', noteId },
  ]);
});

test('a diagram is Mermaid: shown, saved as .mmd, previewed, copied as a fence, updated in place', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'edi-workspace-'));
  const shown: ArtifactSummary[] = [];
  const artifacts = memoryArtifacts();
  const [show, , , update] = workspaceCapabilities({
    directory: () => folder,
    shown: artifact => {
      shown.push(artifact);
    },
    artifacts,
    notes: { store: emptyStore(), directory: () => join(folder, 'Notes') },
    trash: async () => {},
    now: () => 5,
  });
  const context = { callId: '00000000-0000-4000-8000-000000000031', runId: run };
  const mermaid = 'flowchart LR\n  app[Edi] --> api[API]\n  api --> db[(Database)]';
  const result = await (
    await show.prepare({ kind: 'diagram', title: 'Architecture', mermaid }, context)
  ).execute(live());
  const path = join('Artifacts', 'Diagrams', 'architecture.mmd');
  assert.equal((result.output as { path: string }).path, path);
  assert.equal(await readFile(join(folder, path), 'utf8'), `${mermaid}\n`);
  assert.equal(shown[0]?.preview, 'Flowchart: Edi → API → Database');
  assert.equal(
    artifactExport({ kind: 'diagram', title: 'A', mermaid }).copy,
    `\`\`\`mermaid\n${mermaid}\n\`\`\`\n`,
  );
  assert.throws(
    () => show.prepare({ kind: 'diagram', title: 'Empty' }, context),
    /needs its Mermaid source/,
  );

  // “Add the MCP layer” replaces the same diagram rather than making a new one.
  const next = `${mermaid}\n  app --> mcp[MCP servers]`;
  await (
    await update.prepare(
      { id: context.callId, kind: 'diagram', title: 'Architecture', mermaid: next },
      context,
    )
  ).execute(live());
  assert.equal(await readFile(join(folder, path), 'utf8'), `${next}\n`);
  assert.equal(artifacts.records.length, 1);
  assert.match(shown.at(-1)?.preview ?? '', /MCP servers/);
  assert.throws(
    () =>
      update.prepare(
        { id: context.callId, kind: 'table', title: 'X', columns: ['a'], rows: [['1']] },
        context,
      ),
    /is a diagram/,
  );
});

test('workspace.show validates content by kind and is exposed as a plain object schema', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'edi-workspace-'));
  const shown: { kind: string; title: string }[] = [];
  const artifacts = memoryArtifacts();
  const [show] = workspaceCapabilities({
    directory: () => folder,
    shown: artifact => {
      shown.push(artifact);
    },
    artifacts,
    notes: { store: emptyStore(), directory: () => join(folder, 'Notes') },
    trash: async () => {},
    now: () => 5,
  });
  const context = { callId: '00000000-0000-4000-8000-000000000021', runId: run };
  const list = await show.prepare(
    { kind: 'checklist', title: 'Packing', items: [{ text: 'Passport', done: false }] },
    context,
  );
  const result = await list.execute(live());
  assert.deepEqual(result.output, {
    shown: true,
    kind: 'checklist',
    title: 'Packing',
    path: join('Artifacts', 'Checklists', 'packing.md'),
    bytes: Buffer.byteLength('# Packing\n\n- [ ] Passport\n'),
  });
  assert.equal(
    await readFile(join(folder, 'Artifacts', 'Checklists', 'packing.md'), 'utf8'),
    '# Packing\n\n- [ ] Passport\n',
  );
  assert.deepEqual(
    shown.map(({ kind, title }) => ({ kind, title })),
    [{ kind: 'checklist', title: 'Packing' }],
  );
  // Recorded in the workspace under the showing call's id, so the conversation card still opens it.
  assert.deepEqual(artifacts.records[0], {
    id: context.callId,
    kind: 'checklist',
    title: 'Packing',
    content: { kind: 'checklist', title: 'Packing', items: [{ text: 'Passport', done: false }] },
    path: join('Artifacts', 'Checklists', 'packing.md'),
    bytes: Buffer.byteLength('# Packing\n\n- [ ] Passport\n'),
    createdAt: 5,
    updatedAt: 5,
  });
  assert.throws(() => show.prepare({ kind: 'table', title: 'Empty' }, context), /needs columns/);
  const broker = new CapabilityBroker([show], {
    approvals: gate('never'),
    recorder: recorder().sink,
  });
  assert.equal((broker.manifest()[0]!.inputSchema as { type: string }).type, 'object');
});

test('Edi searches, reads, updates and trashes workspace items, confined to its folder', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'edi-manage-'));
  const notesFolder = join(folder, 'Notes');
  await mkdir(notesFolder, { recursive: true });
  const notePath = join(notesFolder, 'palette.md');
  await writeFile(notePath, '# Palette\n\nWarm clay and sage for Mochi.\n');
  const notes = memoryStore([{ id: noteId, title: 'Palette', path: notePath, createdAt: 1 }]);
  const artifacts = memoryArtifacts();
  const trashed: string[] = [];
  const shown: { id: string; title: string }[] = [];
  let clock = 10;
  const deps = {
    directory: () => folder,
    shown: (artifact: { id: string; title: string }) => void shown.push(artifact),
    artifacts,
    notes: { store: notes, directory: () => notesFolder },
    trash: async (path: string) => {
      trashed.push(path);
      await rm(path);
    },
    now: () => clock++,
  };
  const [show, search, read, update, remove] = workspaceCapabilities(deps);
  const listId = '00000000-0000-4000-8000-000000000031';
  await (
    await show.prepare(
      { kind: 'checklist', title: 'Packing', items: [{ text: 'Passport', done: false }] },
      { callId: listId, runId: run },
    )
  ).execute(live());

  const found = async (query?: string, kind?: 'note') =>
    (
      (await (await search.prepare({ query, kind }, { callId: run, runId: run })).execute(live()))
        .output as { results: { id: string; kind: string; snippet: string }[] }
    ).results;
  assert.deepEqual(
    (await found()).map(item => item.id),
    [listId, noteId],
  );
  assert.deepEqual(
    (await found('sage mochi')).map(item => item.id),
    [noteId],
  );
  assert.match((await found('sage'))[0]!.snippet, /Warm clay and sage/);
  assert.deepEqual(
    (await found('passport')).map(item => item.kind),
    ['checklist'],
  );
  assert.deepEqual(
    (await found(undefined, 'note')).map(item => item.id),
    [noteId],
  );
  assert.deepEqual(await found('nothing like this'), []);

  const readOut = async (id: string) =>
    (await (await read.prepare({ id }, { callId: run, runId: run })).execute(live())).output;
  assert.deepEqual(await readOut(listId), {
    id: listId,
    kind: 'checklist',
    title: 'Packing',
    text: '# Packing\n\n- [ ] Passport\n',
  });
  assert.equal(
    ((await readOut(noteId)) as { text: string }).text,
    '# Palette\n\nWarm clay and sage for Mochi.\n',
  );

  // Update keeps the place and kind, replaces the file, and reopens the content.
  const context = { callId: run, runId: run };
  // A saved note is edited as a note, with its own review of the new Markdown.
  const noteEdit = update.prepare({ id: noteId, kind: 'note', title: 'x', markdown: 'y' }, context);
  assert.equal((noteEdit as Awaited<typeof noteEdit>).preview.title, 'Edit a note');
  assert.throws(
    () => update.prepare({ id: listId, kind: 'document', title: 'x', markdown: 'y' }, context),
    /Keep the kind/,
  );
  const edit = await update.prepare(
    {
      id: listId,
      kind: 'checklist',
      title: 'Packing',
      items: [
        { text: 'Passport', done: true },
        { text: 'Charger', done: false },
      ],
    },
    context,
  );
  assert.equal(edit.preview.action, 'Update');
  await edit.execute(live());
  const listPath = join(folder, 'Artifacts', 'Checklists', 'packing.md');
  assert.equal(await readFile(listPath, 'utf8'), '# Packing\n\n- [x] Passport\n- [ ] Charger\n');
  assert.deepEqual(await readdir(join(folder, 'Artifacts', 'Checklists')), ['packing.md']);
  assert.equal(shown.at(-1)?.id, listId);

  // Delete moves files to the Trash, for generated items and notes alike, and forgets them.
  const trashList = await remove.prepare({ id: listId }, context);
  assert.equal(trashList.preview.action, 'Move to Trash');
  await trashList.execute(live());
  await (await remove.prepare({ id: noteId }, context)).execute(live());
  assert.deepEqual(trashed, [listPath, notePath]);
  assert.equal(artifacts.records.length, 0);
  assert.equal(notes.records.length, 0);
  assert.throws(() => remove.prepare({ id: listId }, context), /nothing in its workspace/);

  // A record pointing outside Documents/Edi/Artifacts is refused, never trashed.
  artifacts.add({
    id: listId,
    kind: 'document',
    title: 'Escape',
    content: { kind: 'document', title: 'Escape', markdown: 'x' },
    path: '../../.ssh/id_rsa',
    bytes: 1,
    createdAt: 1,
    updatedAt: 1,
  });
  assert.throws(() => remove.prepare({ id: listId }, context), /outside the Edi workspace/);
});

test('Edi exports workspace items through the host, in formats that suit their kind', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'edi-export-'));
  const notesFolder = join(folder, 'Notes');
  const exported: unknown[] = [];
  const deps = {
    directory: () => folder,
    shown: () => {},
    artifacts: memoryArtifacts(),
    notes: {
      store: memoryStore([{ id: noteId, title: 'Palette', path: join(notesFolder, 'p.md'), createdAt: 1 }]),
      directory: () => notesFolder,
    },
    trash: async () => {},
    exportItem: async (ref: unknown, format: string) => {
      exported.push({ ref, format });
      return { path: join(folder, 'Exports', `Plan.${format}`), name: `Plan.${format}`, bytes: 10 };
    },
  };
  const [show, , , , , exportTool] = workspaceCapabilities(deps);
  assert.ok(exportTool);
  // Exporting writes only a new file inside Edi's own workspace, so it runs without review.
  assert.equal(exportTool.effect, 'read');
  const tableId = '00000000-0000-4000-8000-000000000041';
  const context = { callId: run, runId: run };
  await (
    await show.prepare(
      { kind: 'table', title: 'Plan', columns: ['Step'], rows: [['Ship']] },
      { callId: tableId, runId: run },
    )
  ).execute(live());

  const done = await (await exportTool.prepare({ id: tableId, format: 'pdf' }, context)).execute(
    live(),
  );
  assert.match(done.summary, /Plan\.pdf in Documents\/Edi\/Exports/);
  await (await exportTool.prepare({ id: noteId, format: 'md' }, context)).execute(live());
  assert.deepEqual(exported, [
    { ref: { callId: tableId }, format: 'pdf' },
    { ref: { noteId }, format: 'md' },
  ]);
  assert.throws(() => exportTool.prepare({ id: tableId, format: 'png' }, context), /csv, pdf, md/);
  assert.throws(
    () => exportTool.prepare({ id: '00000000-0000-4000-8000-00000000dead', format: 'pdf' }, context),
    /Search the workspace first/,
  );
  // A host that can't draw exports offers no export tool at all.
  const { exportItem: _unused, ...withoutExport } = deps;
  assert.equal(
    workspaceCapabilities(withoutExport).some(tool => tool.id === 'workspace.export'),
    false,
  );
});

test('workspace artifacts use semantic file formats and never overwrite a generated file', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'edi-artifacts-'));
  const content = {
    kind: 'table' as const,
    title: 'Costs / Q3',
    columns: ['Item', 'Amount'],
    rows: [
      ['Hosting', '1,200'],
      ['Support', '"quoted"'],
    ],
  };
  const first = await writeWorkspaceArtifact(() => folder, content);
  const second = await writeWorkspaceArtifact(() => folder, content);
  assert.equal(first.relativePath, join('Artifacts', 'Tables', 'costs-q3.csv'));
  assert.equal(second.relativePath, join('Artifacts', 'Tables', 'costs-q3-2.csv'));
  assert.equal(
    await readFile(first.path, 'utf8'),
    'Item,Amount\nHosting,"1,200"\nSupport,"""quoted"""\n',
  );
});

test('Edi can open every page, including Settings itself, and change only its own preferences', async () => {
  const opened: string[] = [];
  const changes: unknown[] = [];
  const [, open, change] = ediSetupCapabilities({
    snapshot: () => ({}) as never,
    open: page => opened.push(page),
    change: patch => void changes.push(patch),
    window: () => {},
  });
  const context = { callId: '00000000-0000-4000-8000-000000000022', runId: run };
  for (const page of ['settings', 'home', 'library', 'settings.about'])
    await (await open.prepare({ page } as never, context)).execute(live());
  assert.deepEqual(opened, ['settings', 'home', 'library', 'settings.about']);
  assert.equal(open.input.safeParse({ page: '/settings' }).success, false);

  await (await change.prepare({ character: 'mochi', size: 1.2 }, context)).execute(live());
  assert.deepEqual(changes, [{ character: 'mochi', size: 1.2 }]);
  assert.equal(change.input.safeParse({}).success, false);
  assert.equal(change.input.safeParse({ apiKey: 'x' }).success, false);
  assert.equal(change.input.safeParse({ size: 3 }).success, false);
});

test('workspace search includes matching conversations and understands date ranges', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'edi-search-'));
  const asked: { query: string; after?: number; before?: number }[] = [];
  const [, search] = workspaceCapabilities({
    directory: () => folder,
    shown: () => {},
    artifacts: memoryArtifacts(),
    notes: { store: emptyStore(), directory: () => join(folder, 'Notes') },
    trash: async () => {},
    conversations: {
      search: (query, options) => {
        asked.push({ query, after: options.after, before: options.before });
        return [
          {
            id: 'c1',
            title: 'Brand colors',
            at: new Date(2026, 8, 9, 15).getTime(),
            excerpt: '…five terracotta and sand swatches…',
          },
        ];
      },
    },
  });
  const run = async (input: Record<string, unknown>) =>
    (await (await search.prepare(input as never, { callId: runId, runId })).execute(live())) as {
      summary: string;
      output: { conversations?: { conversation: string; excerpt: string }[] };
    };
  const runId = '00000000-0000-4000-8000-000000000041';
  const result = await run({ query: 'palette', after: '2026-09-07', before: '2026-09-13' });
  assert.equal(result.summary, 'Found 0 items and 1 conversation.');
  assert.deepEqual(result.output.conversations?.[0], {
    conversation: 'Brand colors',
    when: new Date(2026, 8, 9, 15).toISOString(),
    excerpt: '…five terracotta and sand swatches…',
  });
  assert.deepEqual(asked, [
    {
      query: 'palette',
      after: new Date(2026, 8, 7).getTime(),
      before: new Date(2026, 8, 13, 23, 59, 59, 999).getTime(),
    },
  ]);
  // Listing recent items or asking for one kind leaves conversations out.
  assert.equal((await run({})).output.conversations, undefined);
  assert.equal((await run({ query: 'palette', kind: 'note' })).output.conversations, undefined);
  // Dates come as YYYY-MM-DD; the broker refuses anything else before the tool runs.
  assert.equal(search.input.safeParse({ query: 'x', after: 'last week' }).success, false);
});
