import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { HoldHotkey, type HotkeyStatus } from '../../apps/desktop/src/main/input/hold-hotkey';

const helper = { command: process.execPath, args: [resolve('tests/input/fake-hotkey.mjs')] };
const wait = (ms: number) => new Promise(done => setTimeout(done, ms));

function watch(keyCode: number) {
  const events: string[] = [];
  const statuses: HotkeyStatus[] = [];
  const hotkey = new HoldHotkey(
    helper,
    { keyCode, modifiers: 2048, label: 'test' },
    {
      down: () => events.push('down'),
      up: () => events.push('up'),
      status: status => statuses.push(status),
    },
  );
  hotkey.start();
  return { hotkey, events, statuses };
}

test('a hold reports one press and one release; key repeat is ignored', async () => {
  const { hotkey, events, statuses } = watch(1);
  await wait(300);
  assert.deepEqual(events, ['down', 'up']);
  assert.deepEqual(statuses, ['ready']);
  hotkey.dispose();
});

test('a refused registration is unavailable and not retried', async () => {
  const { hotkey, events, statuses } = watch(2);
  await wait(300);
  assert.deepEqual(events, []);
  assert.equal(hotkey.status, 'unavailable');
  assert.deepEqual(statuses, ['unavailable']);
  hotkey.dispose();
});

test('a helper crash mid-hold still releases, then restarts', async () => {
  const { hotkey, events, statuses } = watch(3);
  await wait(300);
  assert.deepEqual(events.slice(0, 2), ['down', 'up']);
  assert.deepEqual(statuses.slice(0, 2), ['ready', 'starting']);
  hotkey.dispose();
});

test('without a helper the chord is simply unavailable', () => {
  const hotkey = new HoldHotkey(
    null,
    { keyCode: 49, modifiers: 2048, label: '⌥ Space' },
    {
      down: () => assert.fail('no press expected'),
      up: () => assert.fail('no release expected'),
    },
  );
  hotkey.start();
  assert.equal(hotkey.status, 'unavailable');
});
