import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ModelOption } from '@edi/contracts';
import { pickModel } from './builtins/edi-setup';

const model = (id: string, name: string, recommended: ModelOption['recommended'] = null) => ({
  id,
  name,
  contextLength: 200_000,
  inputPrice: 1,
  recommended,
});
const models: ModelOption[] = [
  model('anthropic/claude-sonnet-5', 'Anthropic: Claude Sonnet 5', 'balanced'),
  model('anthropic/claude-sonnet-4.5', 'Anthropic: Claude Sonnet 4.5'),
  model('anthropic/claude-opus-5', 'Anthropic: Claude Opus 5', 'best'),
  model('google/gemini-3-flash', 'Google: Gemini 3 Flash', 'fast'),
  model('openrouter/free', 'OpenRouter: Free', 'free'),
  model('openai/gpt-5', 'OpenAI: GPT-5'),
  model('openai/gpt-5-mini', 'OpenAI: GPT-5 Mini'),
  model('openai/gpt-4o', 'OpenAI: GPT-4o'),
];

test('a model is found the way people name it', () => {
  for (const [asked, id] of [
    ['anthropic/claude-sonnet-5', 'anthropic/claude-sonnet-5'],
    ['OpenAI: GPT-4o', 'openai/gpt-4o'],
    ['opus', 'anthropic/claude-opus-5'],
    ['fastest', 'google/gemini-3-flash'],
    ['best model', 'anthropic/claude-opus-5'],
    ['free', 'openrouter/free'],
    ['gpt 5', 'openai/gpt-5'],
    ['gpt-5 mini', 'openai/gpt-5-mini'],
    // Two Sonnets: Edi's own pick among them.
    ['claude sonnet', 'anthropic/claude-sonnet-5'],
  ] as const)
    assert.equal(pickModel(models, asked).id, id, asked);
});

test('several equal matches come back as a question; unknown names say why', () => {
  assert.throws(() => pickModel(models, 'openai'), /Several models match “openai”: .*Ask the user/);
  assert.throws(() => pickModel(models, 'llama'), /No model Edi can use matches “llama”/);
});
