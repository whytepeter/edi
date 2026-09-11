import test from 'node:test';
import assert from 'node:assert/strict';
import {
  permissionPresentation,
  shouldHideCardOnBlur,
  treatScreenRecordingAsGranted,
} from '../../apps/desktop/src/main/permissions';

test('a Screen Recording request uses the system prompt until granted', () => {
  assert.equal(permissionPresentation(false), 'system-prompt');
});

test('already granted skips the prompt', () => {
  assert.equal(permissionPresentation(true), 'already-granted');
});

test('an unpinned card stays up while a permission ask is in flight', () => {
  assert.equal(shouldHideCardOnBlur(false, true), false);
  assert.equal(shouldHideCardOnBlur(false, false), true);
  assert.equal(shouldHideCardOnBlur(true, false), false);
});

test('a previously confirmed grant is trusted when the live check is a false deny', () => {
  assert.equal(treatScreenRecordingAsGranted(false, true), true);
  assert.equal(treatScreenRecordingAsGranted(false, false), false);
  assert.equal(treatScreenRecordingAsGranted(true, false), true);
});
