import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { resolve } from 'node:path';

// Mock the network below the real SDK/adapter. No requests or credentials leave the process.
function launch(mode) {
  const worker = new Worker(
    `
    const { workerData } = require('node:worker_threads');
    global.fetch = async (url, options) => {
      if (!String(url).startsWith('https://openrouter.ai/api/')) throw Error('Unexpected endpoint');
      const body = JSON.parse(options.body);
      if (body.model !== 'test/model' || !body.stream) throw Error('Unexpected request');
      if (workerData.mode === 'error') return new Response('test-only-secret must not escape', { status: 401 });
      if (workerData.mode === 'wait') return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
      });
      const chunk = content => ({ id: 'mock', object: 'chat.completion.chunk', created: 0,
        model: 'test/model', choices: [{ index: 0, delta: { content }, finish_reason: null }] });
      const data = [chunk('Hello '), chunk('from Edi.'), { ...chunk(''), choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }]
        .map(value => 'data: ' + JSON.stringify(value) + '\\n\\n').join('') + 'data: [DONE]\\n\\n';
      return new Response(data, { headers: { 'content-type': 'text/event-stream' } });
    };
    require(workerData.entry);
  `,
    {
      eval: true,
      workerData: {
        entry: resolve('apps/desktop/out/main/agent-worker.js'),
        apiKey: 'test-only-secret',
        model: 'test/model',
        prompt: 'Hello',
        mode,
      },
    },
  );
  return worker;
}
function collect(worker) {
  return new Promise((resolve, reject) => {
    const messages = [];
    const timeout = setTimeout(() => {
      void worker.terminate();
      reject(Error('Worker timed out'));
    }, 8000);
    worker.on('message', message => messages.push(message));
    worker.on('error', reject);
    worker.on('exit', code => {
      clearTimeout(timeout);
      if (code === 0) resolve(messages);
      else reject(Error('Worker exit ' + code));
    });
  });
}
test('real SDK worker streams mocked OpenRouter text', async () => {
  const messages = await collect(launch('success'));
  assert.equal(
    messages
      .filter(m => m.type === 'text')
      .map(m => m.text)
      .join(''),
    'Hello from Edi.',
  );
  assert.equal(messages.at(-1).type, 'done');
});
test('provider errors do not expose request metadata', async () => {
  const messages = await collect(launch('error'));
  assert.equal(JSON.stringify(messages).includes('test-only-secret'), false);
  assert.equal(messages.at(-1).type, 'error');
});
test('worker accepts cancellation during a request', async () => {
  const worker = launch('wait');
  const result = collect(worker);
  setTimeout(() => worker.postMessage('stop'), 500);
  const messages = await result;
  assert.equal(
    messages.some(m => m.type === 'text'),
    false,
  );
});
