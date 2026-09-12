import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldHideCardOnBlur } from '../../apps/desktop/src/main/permissions';

test('an unpinned card stays up while a permission ask is in flight', () => {
  assert.equal(shouldHideCardOnBlur(false, true), false);
  assert.equal(shouldHideCardOnBlur(false, false), true);
  assert.equal(shouldHideCardOnBlur(true, false), false);
});
