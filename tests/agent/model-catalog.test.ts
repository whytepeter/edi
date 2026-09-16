import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ModelCatalog,
  compatibleModels,
  quickEffort,
  quickEffortsFrom,
  readerModelFrom,
} from '../../apps/desktop/src/main/agent/model-catalog';

const vision = {
  id: 'vendor/sees-and-calls',
  name: 'Vendor: Sees and Calls',
  context_length: 128000,
  architecture: { input_modalities: ['text', 'image'] },
  pricing: { prompt: '0.0000025' },
  supported_parameters: ['tools', 'temperature'],
};

test('only models with image input and tool calling are offered', () => {
  const models = compatibleModels({
    data: [
      vision,
      { ...vision, id: 'vendor/text-only', architecture: { input_modalities: ['text'] } },
      { ...vision, id: 'vendor/no-tools', supported_parameters: ['temperature'] },
      { ...vision, id: 'bad id with spaces' },
      'not an object',
    ],
  });
  assert.deepEqual(models, [
    {
      id: 'vendor/sees-and-calls',
      name: 'Vendor: Sees and Calls',
      contextLength: 128000,
      inputPrice: 2.5,
      recommended: null,
    },
  ]);
});

test('unknown prices stay unknown instead of looking free', () => {
  const [model] = compatibleModels({ data: [{ ...vision, pricing: { prompt: '-1' } }] });
  assert.equal(model?.inputPrice, null);
  assert.throws(() => compatibleModels({ models: [] }));
});

test('the catalog is fetched once and shared by concurrent callers', async () => {
  let calls = 0;
  const catalog = new ModelCatalog((async () => {
    calls++;
    return new Response(JSON.stringify({ data: [vision] }));
  }) as typeof fetch);
  const [first, second] = await Promise.all([catalog.list(), catalog.list()]);
  assert.equal(first.length, 1);
  assert.equal(second, first);
  await catalog.list();
  assert.equal(calls, 1);
});

test('recommendations pick the newest model of each suited family, never a batch or lite variant', () => {
  const entry = (id: string, created: number) => ({ ...vision, id, created });
  const models = compatibleModels({
    data: [
      entry('google/gemini-3.7-flash', 2),
      entry('google/gemini-3.8-flash', 3),
      entry('google/gemini-3.8-flash:batch', 4),
      entry('google/gemini-3.5-flash-lite', 5),
      entry('anthropic/claude-sonnet-5', 1),
      entry('anthropic/claude-opus-5', 1),
      entry('openrouter/free', 1),
      entry('vendor/other', 9),
    ],
  });
  const picked = Object.fromEntries(
    models.filter(model => model.recommended).map(model => [model.recommended, model.id]),
  );
  assert.deepEqual(picked, {
    fast: 'google/gemini-3.8-flash',
    balanced: 'anthropic/claude-sonnet-5',
    best: 'anthropic/claude-opus-5',
    free: 'openrouter/free',
  });
});

test('the page reader is the newest Gemini Flash Lite, by version, else the fast pick', () => {
  const option = (id: string, recommended: 'fast' | null = null) => ({
    id,
    name: id,
    contextLength: 1_000_000,
    inputPrice: 0.3,
    recommended,
  });
  assert.equal(
    readerModelFrom([
      option('google/gemini-3.1-flash-lite'),
      option('google/gemini-3.10-flash-lite'),
      option('google/gemini-3.5-flash-lite-preview'),
      option('google/gemini-3.8-flash', 'fast'),
    ]),
    'google/gemini-3.10-flash-lite',
  );
  assert.equal(
    readerModelFrom([option('google/gemini-3.8-flash', 'fast')]),
    'google/gemini-3.8-flash',
  );
  assert.equal(readerModelFrom([]), null);
});

test('spoken turns ask for the least reasoning each model allows', () => {
  const entry = (id: string, reasoning: unknown) => ({ ...vision, id, reasoning });
  const efforts = quickEffortsFrom({
    data: [
      // Optional reasoning is switched off.
      entry('anthropic/claude-sonnet-5', {
        mandatory: false,
        supported_efforts: ['max', 'xhigh', 'high', 'medium', 'low'],
      }),
      // Required reasoning gets its lowest level.
      entry('google/gemini-3.8-flash', {
        mandatory: true,
        supported_efforts: ['high', 'medium', 'low'],
      }),
      // Unknown levels, only high levels or no reasoning keep the model's default.
      entry('google/gemini-2.5-pro', { mandatory: true }),
      entry('vendor/only-high', { mandatory: true, supported_efforts: ['high'] }),
      entry('openai/gpt-4o-mini', undefined),
      // A model Edi cannot offer still gets its level: the saved model may predate the filter.
      { id: 'vendor/text-only', reasoning: { mandatory: false } },
    ],
  });
  assert.deepEqual(Object.fromEntries(efforts), {
    'anthropic/claude-sonnet-5': 'none',
    'google/gemini-3.8-flash': 'low',
    'vendor/text-only': 'none',
  });
  assert.equal(quickEffort(null), undefined);
});

test('the quickest reasoning level never waits for the catalog', async () => {
  let calls = 0;
  const catalog = new ModelCatalog((async () => {
    calls++;
    return new Response(JSON.stringify({ data: [{ ...vision, reasoning: { mandatory: false } }] }));
  }) as typeof fetch);
  // Nothing loaded yet: no level, and the catalog starts loading in the background.
  assert.equal(catalog.quickEffort(vision.id), undefined);
  await catalog.list();
  assert.equal(calls, 1);
  assert.equal(catalog.quickEffort(vision.id), 'none');
  assert.equal(catalog.quickEffort('vendor/unknown'), undefined);
});
