import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LocalModels,
  lmStudioModels,
  ollamaModel,
} from '../../apps/desktop/src/main/agent/local-models';
import { localModelId, parseLocalModelId } from '../../packages/contracts/src/index';

test('local model ids name their runtime and never look like OpenRouter ids', () => {
  assert.equal(localModelId('ollama', 'qwen2.5vl:7b'), 'local/ollama/qwen2.5vl:7b');
  assert.deepEqual(parseLocalModelId('local/lmstudio/mlx-community/qwen2-vl'), {
    runtime: 'lmstudio',
    name: 'mlx-community/qwen2-vl',
  });
  assert.equal(parseLocalModelId('google/gemini-2.5-flash'), null);
  assert.equal(parseLocalModelId('local/other/model'), null);
  assert.equal(parseLocalModelId('local/ollama/'), null);
});

test('each runtime says what a model can do; one without images or tools is limited', () => {
  assert.deepEqual(
    ollamaModel('qwen2.5vl:7b', {
      capabilities: ['completion', 'vision', 'tools'],
      model_info: { 'qwen25vl.context_length': 128_000 },
    }),
    {
      id: 'local/ollama/qwen2.5vl:7b',
      runtime: 'ollama',
      name: 'qwen2.5vl:7b',
      contextLength: 128_000,
      vision: true,
      tools: true,
    },
  );
  const textOnly = ollamaModel('llama3.2:3b', { capabilities: ['completion', 'tools'] });
  assert.equal(textOnly?.vision, false);
  assert.equal(textOnly?.tools, true);
  // A model Ollama couldn't describe is listed, but can't be trusted with images or tools.
  assert.deepEqual(
    [ollamaModel('mystery', {})?.vision, ollamaModel('mystery', {})?.tools],
    [false, false],
  );
  assert.equal(ollamaModel('nomic-embed-text', { capabilities: ['embedding'] }), null);
  assert.equal(ollamaModel('bad name!', {}), null);

  assert.deepEqual(
    lmStudioModels({
      data: [
        {
          id: 'qwen2-vl-7b-instruct',
          type: 'vlm',
          max_context_length: 32_768,
          capabilities: ['tool_use'],
        },
        { id: 'mistral-7b', type: 'llm', max_context_length: 8192 },
        { id: 'text-embedding-nomic', type: 'embeddings' },
      ],
    }).map(model => [model.id, model.vision, model.tools, model.contextLength]),
    [
      ['local/lmstudio/qwen2-vl-7b-instruct', true, true, 32_768],
      ['local/lmstudio/mistral-7b', false, false, 8192],
    ],
  );
  assert.deepEqual(lmStudioModels({ unexpected: true }), []);
});

test('discovery asks only this Mac, lists suitable models first, and says which runtimes answered', async () => {
  const asked: string[] = [];
  const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
  const fetcher = (async (url: string | URL, init?: RequestInit) => {
    asked.push(String(url));
    if (String(url).endsWith('/api/tags'))
      return json({ models: [{ name: 'llama3.2:3b' }, { name: 'qwen2.5vl:7b' }] });
    if (String(url).endsWith('/api/show')) {
      const { model } = JSON.parse(String(init?.body)) as { model: string };
      return json({
        capabilities: model === 'qwen2.5vl:7b' ? ['completion', 'vision', 'tools'] : ['completion'],
      });
    }
    throw new TypeError('fetch failed'); // LM Studio isn't running
  }) as typeof fetch;

  const models = new LocalModels(fetcher);
  const state = await models.list();
  assert.deepEqual(state.runtimes, [
    { id: 'ollama', running: true },
    { id: 'lmstudio', running: false },
  ]);
  assert.deepEqual(
    state.models.map(model => model.id),
    ['local/ollama/qwen2.5vl:7b', 'local/ollama/llama3.2:3b'],
  );
  assert.ok(asked.every(url => url.startsWith('http://127.0.0.1:')));
  // A second look within a few seconds is served from memory.
  const before = asked.length;
  assert.equal((await models.find('local/ollama/llama3.2:3b'))?.vision, false);
  assert.equal(asked.length, before);
});
