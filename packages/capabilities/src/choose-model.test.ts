import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ModelOption } from '@edi/contracts';
import { pickModel, turnSetup, type EdiSetupSnapshot } from './builtins/edi-setup';

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

test('each question carries the setup that changes; the long lists stay in edi_inspect_setup', () => {
  const snapshot = {
    identity: { name: 'Edi', customName: false, app: 'Edi', version: '0.1.0' },
    location: { page: 'home', cardOpen: true, pinned: false },
    current: { character: { id: 'edi', name: 'Edi' }, size: 1 },
    workspace: { root: '/Edi', generatedContent: '/Edi/Artifacts', behavior: 'Saved.' },
    library: { items: 1, notes: 1, artifacts: 0, recent: [{ id: 'n1', title: 'Groceries' }] },
    skills: [{ id: 'trip-planner', name: 'Trip Planner', active: true }],
    connectors: [
      { id: 'notion', name: 'Notion', active: true },
      { id: 'linear', name: 'Linear', active: false },
    ],
    appsToConnect: [{ id: 'todoist', name: 'Todoist' }],
    permissions: [{ id: 'microphone', status: 'granted' }],
    availableCharacters: [{ id: 'edi', name: 'Edi' }],
    availableVoices: [{ id: 'kokoro', name: 'Kokoro', voices: [] }],
    abilities: [{ name: 'Answer questions', asksFirst: false }],
    notYetAvailable: ['Clicking or typing in other apps'],
  } as unknown as EdiSetupSnapshot;
  const turn = turnSetup(snapshot);
  assert.deepEqual(Object.keys(turn).sort(), [
    'appsToConnect',
    'connectors',
    'current',
    'identity',
    'library',
    'location',
    'more',
    'notYetAvailable',
    'permissions',
    'workspace',
  ]);
  assert.deepEqual(turn.connectors, [{ id: 'notion', name: 'Notion', active: true }]);
  assert.match(turn.more, /edi_inspect_setup/);
});
