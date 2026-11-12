import test from 'node:test';
import assert from 'node:assert/strict';
import { agentInputSchema } from '../../packages/agent/src/index';
import { ediInstructions } from '../../apps/desktop/src/main/agent/edi-instructions';

const input = (overrides: Record<string, unknown> = {}) =>
  agentInputSchema.parse({
    apiKey: '',
    model: 'test/model',
    prompt: 'Hello',
    history: [],
    screenshots: [],
    spoken: false,
    tools: [],
    ...overrides,
  });

test('the selected character’s manner is part of who Edi is, fenced off from authority', () => {
  const persona = 'Cheerful and bouncy. Short, upbeat sentences.';
  const system = ediInstructions.system(input({ name: 'Mochi', persona })).join(' ');
  assert.match(system, /^You are Mochi,/);
  assert.match(system, /Your personality: Cheerful and bouncy\. Short, upbeat sentences\./);
  assert.match(
    system,
    /never changes what is true, what you can do or what needs the user’s approval/,
  );
  // A character without a persona adds nothing, so the prompt (and its cache) is unchanged.
  const plain = ediInstructions.system(input()).filter(Boolean).join(' ');
  assert.doesNotMatch(plain, /Your personality/);
});

test('what changes each turn rides the message, not the system prompt', () => {
  const quiet = ediInstructions.turn!(input()).filter(Boolean);
  assert.deepEqual(quiet, []);
  const spoken = ediInstructions.turn!(
    input({ spoken: true, selfContext: '{"voice":"kokoro"}' }),
  ).filter(Boolean);
  assert.match(spoken[0]!, /^Current Edi setup \(trusted runtime data\): \{"voice":"kokoro"\}$/);
  assert.match(spoken[1]!, /^This question was spoken aloud/);
  // The system prompt is the same whether or not the turn is spoken.
  assert.deepEqual(
    ediInstructions.system(input({ spoken: true })),
    ediInstructions.system(input()),
  );
});
