import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandSchema, settingsSchema } from './index';

test('bridge rejects unknown capabilities and invalid skin selections', () => {
  assert.equal(commandSchema.safeParse({ type: 'execute', command: 'anything' }).success, false);
  assert.equal(commandSchema.safeParse({ type: 'apply-skin', skin: '../untrusted' }).success, false);
  assert.equal(commandSchema.safeParse({ type: 'pet-hit-test', interactive: 'yes' }).success, false);
});
test('stored settings require a supported avatar and boolean pin state', () => {
  assert.equal(settingsSchema.safeParse({ skin: 'sprout', pinned: true }).success, true);
  assert.equal(settingsSchema.safeParse({ skin: 'cloud' }).success, false);
});
