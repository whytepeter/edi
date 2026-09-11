import test from 'node:test';
import assert from 'node:assert/strict';
import { nextRevealedText } from '../../apps/desktop/src/renderer/src/features/pet/reveal-text';

test('reveals a few more characters of a growing reply', () => {
  assert.equal(nextRevealedText('', 'Hello', 3), 'Hel');
  assert.equal(nextRevealedText('Hel', 'Hello', 3), 'Hello');
});

test('a new reply replaces the previous one', () => {
  assert.equal(nextRevealedText('Hello', 'Hi there', 3), 'Hi there');
});

test('an empty incoming reply clears the bubble', () => {
  assert.equal(nextRevealedText('Hello', ''), '');
});
