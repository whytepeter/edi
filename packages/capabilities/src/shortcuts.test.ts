import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortcutsCapabilities } from './index';

const context = {
  callId: '00000000-0000-4000-8000-000000000001',
  runId: '00000000-0000-4000-8000-000000000002',
};
const live = () => new AbortController().signal;

function setup(names = ['Start Focus', 'Log Water', 'Make GIF']) {
  const ran: { name: string; input: string | undefined }[] = [];
  const [list, run] = shortcutsCapabilities({
    list: async () => names,
    run: async (name, input) => {
      ran.push({ name, input });
      return name === 'Log Water' ? '' : `${name} done`;
    },
  });
  return { list, run, ran };
}

test('a shortcut runs by its exact name, with the user’s review and their input', async () => {
  const { run, ran } = setup();
  const prepared = await run.prepare({ name: 'start focus', input: 'until 5pm' }, context);
  assert.equal(prepared.preview.action, 'Run');
  assert.equal(prepared.preview.summary, 'Run “Start Focus” in Shortcuts.');
  assert.deepEqual(prepared.preview.fields, [{ label: 'With', value: 'until 5pm' }]);
  // "Always allow" covers this one shortcut, not shortcuts in general.
  assert.deepEqual(prepared.scope, {
    kind: 'app',
    value: 'Start Focus',
    label: 'the “Start Focus” shortcut',
    covers: ['Start Focus'],
  });

  const result = await prepared.execute(live());
  assert.equal(result.summary, 'Ran “Start Focus”.');
  assert.deepEqual(result.output, { shortcut: 'Start Focus', result: 'Start Focus done' });
  assert.deepEqual(ran, [{ name: 'Start Focus', input: 'until 5pm' }]);

  // One that returns nothing says so, instead of looking empty-handed.
  const quiet = await (await run.prepare({ name: 'Log Water' }, context)).execute(live());
  assert.deepEqual(quiet.output, {
    shortcut: 'Log Water',
    result: '',
    note: 'It returned nothing.',
  });
});

test('an unknown name suggests the near ones, and lists what there is', async () => {
  const { list, run } = setup();
  await assert.rejects(
    async () => run.prepare({ name: 'focus' }, context),
    /no shortcut called “focus”\. Did they mean “Start Focus”\?/,
  );
  await assert.rejects(
    async () => run.prepare({ name: 'Send Invoice' }, context),
    /Use shortcuts_list to see what they have/,
  );

  const listed = await (await list.prepare({}, context)).execute(live());
  assert.equal(listed.summary, 'Found 3 shortcuts.');
  assert.deepEqual(listed.output, { shortcuts: ['Start Focus', 'Log Water', 'Make GIF'] });

  const none = setup([]);
  const empty = await (await none.list.prepare({}, context)).execute(live());
  assert.equal(empty.summary, 'No shortcuts on this Mac.');
});
