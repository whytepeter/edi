import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PermissionManager,
  type PermissionAdapter,
} from '../../apps/desktop/src/main/permission-manager';
import type { PermissionId, PermissionStatus } from '../../packages/contracts/src/index';

function harness() {
  const status: Record<PermissionId, PermissionStatus> = {
    microphone: 'not-determined',
    'screen-recording': 'denied',
  };
  const requested: PermissionId[] = [];
  const opened: PermissionId[] = [];
  let presentations = 0;
  const adapter = (id: PermissionId): PermissionAdapter => ({
    status: () => status[id],
    request: async () => {
      requested.push(id);
      return status[id];
    },
    openSettings: async () => {
      opened.push(id);
    },
  });
  const manager = new PermissionManager(
    { microphone: adapter('microphone'), 'screen-recording': adapter('screen-recording') },
    () => presentations++,
  );
  return { manager, status, requested, opened, presentations: () => presentations };
}

test('missing permissions queue once and granted permissions do not present', () => {
  const h = harness();
  assert.equal(h.manager.require('microphone'), false);
  assert.equal(h.manager.require('microphone'), false);
  h.status['screen-recording'] = 'granted';
  assert.equal(h.manager.require('screen-recording'), true);
  assert.equal(h.manager.snapshot().active, 'microphone');
  assert.equal(h.presentations(), 2);
});

test('grant advances the queue; dismiss and settings stay scoped to their id', async () => {
  const h = harness();
  h.manager.require('microphone');
  h.manager.require('screen-recording');
  h.status.microphone = 'granted';
  await h.manager.request('microphone');
  assert.deepEqual(h.requested, ['microphone']);
  assert.equal(h.manager.snapshot().active, 'screen-recording');
  await h.manager.openSettings('screen-recording');
  assert.deepEqual(h.opened, ['screen-recording']);
  h.manager.dismiss('screen-recording');
  assert.equal(h.manager.snapshot().active, null);
});
