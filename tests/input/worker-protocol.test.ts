import test from 'node:test';
import assert from 'node:assert/strict';
import { workerInputSchema } from '../../apps/desktop/src/main/agent/worker-protocol';

const valid = () => ({
  apiKey: 'openrouter-test-key',
  model: 'provider/model',
  prompt: 'Hello',
  history: [],
  screenshots: [],
  spoken: false,
  tools: [],
});

test('agent worker input accepts only bounded startup data', () => {
  assert.equal(workerInputSchema.safeParse(valid()).success, true);
  assert.equal(
    workerInputSchema.safeParse({ ...valid(), prompt: 'x'.repeat(8_001) }).success,
    false,
  );
  assert.equal(
    workerInputSchema.safeParse({
      ...valid(),
      screenshots: [{ label: 'screen', jpeg: new Uint8Array(8 * 1024 * 1024 + 1) }],
    }).success,
    false,
  );
  assert.equal(workerInputSchema.safeParse({ ...valid(), extra: true }).success, false);
});
