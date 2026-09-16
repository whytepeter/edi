import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activityCapabilities, fileCapabilities, reversal, type RecordedAction } from './index';

const live = () => new AbortController().signal;
let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

async function setup() {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'edi-undo-')));
  await mkdir(join(home, 'Desktop/Screenshots'), { recursive: true });
  const files = fileCapabilities({
    home,
    roots: () => [{ name: 'Desktop', path: join(home, 'Desktop'), access: 'allowed' }],
    workspace: join(home, 'Documents/Edi'),
    trash: async path => {
      await import('node:fs/promises').then(fs => fs.rm(path, { recursive: true }));
    },
    spotlight: async () => [],
  });
  const log: RecordedAction[] = [];
  /** Run a tool as the broker would, recording it like tool_calls does. */
  const run = async (tool: (typeof files)[number] | ReturnType<typeof activityCapabilities>[number], input: unknown) => {
    const context = { callId: uuid(), runId: uuid() };
    const prepared = await tool.prepare(tool.input.parse(input) as never, context);
    const result = await prepared.execute(live());
    log.unshift({
      id: context.callId,
      runId: context.runId,
      capability: tool.id,
      title: tool.title,
      effect: tool.effect,
      status: 'succeeded',
      summary: result.summary,
      input,
      output: result.output ?? null,
      createdAt: Date.now(),
    });
    return { prepared, result };
  };
  const [recent, undo] = activityCapabilities({
    recent: limit => log.slice(0, limit),
    tool: id => files.find(tool => tool.id === id),
    home,
  });
  return { home, files, run, recent, undo, log };
}

test('undo puts moved screenshots back under their own names, once', async () => {
  const { home, files, run, recent, undo } = await setup();
  const shot = 'Screenshot 2026-09-11 at 10.35.11 PM.png';
  await writeFile(join(home, 'Desktop', shot), 'png');
  await run(files.find(tool => tool.id === 'files.move')!, {
    moves: [
      {
        from: '~/Desktop/Screenshot 2026-09-11 at 10.35.11 PM.png',
        to: '~/Desktop/Screenshots/Screenshot 2026-09-11 at 10.35.11 PM.png',
      },
    ],
  });

  const listed = (await run(recent, {})).result.output as {
    actions: { what: string; undo: string }[];
  };
  assert.deepEqual(listed.actions.map(action => [action.what, action.undo]), [
    ['Move files', 'Edi can undo it'],
  ]);

  const { prepared } = await run(undo, {});
  assert.equal(prepared.preview.action, 'Undo');
  assert.match(prepared.preview.summary, /^Put .+ back\.$/);
  // Back where it was, with the narrow no-break space it had.
  assert.ok((await readdir(join(home, 'Desktop'))).includes(shot));
  assert.deepEqual(await readdir(join(home, 'Desktop/Screenshots')), []);

  await assert.rejects(async () => undo.prepare({}, { callId: uuid(), runId: uuid() }), /nothing recent Edi can undo/);
});

test('a new folder is undone only while empty; other actions say how to reverse them', async () => {
  const { home, files, run, undo } = await setup();
  await run(files.find(tool => tool.id === 'files.create_folder')!, { paths: ['~/Desktop/Plans'] });
  await writeFile(join(home, 'Desktop/Plans/idea.txt'), 'x');
  await assert.rejects(async () => undo.prepare({}, { callId: uuid(), runId: uuid() }), /has things in it now/);

  const action = (capability: string): RecordedAction => ({
    id: uuid(),
    runId: uuid(),
    capability,
    title: capability,
    effect: 'write',
    status: 'succeeded',
    summary: '',
    input: { title: 'Dentist' },
    output: capability === 'calendar.create' ? { eventId: 'E1' } : {},
    createdAt: 0,
  });
  assert.match(JSON.stringify(reversal(action('files.trash'))), /Put Back/);
  assert.match(JSON.stringify(reversal(action('reminders.create'))), /delete them in Reminders/);
  assert.deepEqual(reversal(action('calendar.create')), {
    tool: 'calendar.delete',
    input: { eventId: 'E1', title: 'Dentist' },
    label: 'Remove the event “Dentist”',
  });
  assert.match(JSON.stringify(reversal({ ...action('files.move'), status: 'denied' })), /didn’t go through/);
});
