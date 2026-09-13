import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { resolve } from 'node:path';

const notesSave = {
  name: 'notes_save',
  description: 'Save a note',
  inputSchema: {
    type: 'object',
    properties: { title: { type: 'string' }, body: { type: 'string' } },
    required: ['title', 'body'],
    additionalProperties: false,
  },
};

// Mock the network below the real SDK/adapter. No requests or credentials leave the process.
// Each request body is echoed to the test as a `debug-request` message for inspection.
function launch(mode, tools = [], context = {}) {
  const worker = new Worker(
    `
    const { workerData, parentPort } = require('node:worker_threads');
    const workerEntry = workerData.entry;
    const testMode = workerData.mode;
    delete workerData.entry;
    delete workerData.mode;
    let requests = 0;
    const sse = values => new Response(
      values.map(value => 'data: ' + JSON.stringify(value) + '\\n\\n').join('') + 'data: [DONE]\\n\\n',
      { headers: { 'content-type': 'text/event-stream' } },
    );
    const chunk = delta => ({ id: 'mock', object: 'chat.completion.chunk', created: 0,
      model: 'test/model', choices: [{ index: 0, delta, finish_reason: null }] });
    const end = reason => ({ ...chunk({}), choices: [{ index: 0, delta: {}, finish_reason: reason }] });
    global.fetch = async (url, options) => {
      if (!String(url).startsWith('https://openrouter.ai/api/')) throw Error('Unexpected endpoint');
      const body = JSON.parse(options.body);
      if (body.model !== 'test/model' || !body.stream) throw Error('Unexpected request');
      parentPort.postMessage({ type: 'debug-request', body });
      requests++;
      if (testMode === 'error') return new Response('test-only-secret must not escape', { status: 401 });
      if (testMode === 'wait') return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
      });
      if (testMode === 'tool' && requests === 1) {
        return sse([
          chunk({ role: 'assistant', content: null, tool_calls: [{ index: 0, id: 'call_1', type: 'function',
            function: { name: 'notes_save', arguments: '{"title":"Groceries","body":"- milk"}' } }] }),
          end('tool_calls'),
        ]);
      }
      return sse([chunk({ content: testMode === 'tool' ? 'Saved it.' : 'Hello ' }),
        ...(testMode === 'tool' ? [] : [chunk({ content: 'from Edi.' })]), end('stop')]);
    };
    require(workerEntry);
  `,
    {
      eval: true,
      workerData: {
        entry: resolve('apps/desktop/out/main/agent-worker.js'),
        apiKey: 'test-only-secret',
        model: 'test/model',
        prompt: 'Hello',
        history: context.history ?? [],
        screenshots: context.screenshots ?? [],
        spoken: false,
        tools,
        mode,
      },
    },
  );
  return worker;
}

/** Plays the main process: answers tool calls with `respond`, collects everything else. */
function collect(worker, respond) {
  return new Promise((resolve, reject) => {
    const messages = [];
    const requests = [];
    const timeout = setTimeout(() => {
      void worker.terminate();
      reject(Error('Worker timed out'));
    }, 8000);
    worker.on('message', message => {
      if (message.type === 'debug-request') return requests.push(message.body);
      messages.push(message);
      if (message.type === 'tool-call' && respond) {
        worker.postMessage({ type: 'tool-result', id: message.id, outcome: respond(message) });
      }
    });
    worker.on('error', reject);
    worker.on('exit', code => {
      clearTimeout(timeout);
      if (code === 0) resolve({ messages, requests });
      else reject(Error('Worker exit ' + code));
    });
  });
}

const text = messages =>
  messages
    .filter(m => m.type === 'text')
    .map(m => m.text)
    .join('');

test('real SDK worker streams mocked OpenRouter text', async () => {
  const { messages, requests } = await collect(launch('success'));
  assert.equal(text(messages), 'Hello from Edi.');
  assert.equal(messages.at(-1).type, 'done');
  assert.deepEqual(
    requests[0].tools.find(tool => tool.type === 'openrouter:web_search'),
    {
      type: 'openrouter:web_search',
      engine: 'auto',
      max_results: 5,
    },
  );
  assert.match(JSON.stringify(requests[0].messages[0].content), /Use web_search for current/);
});

test('provider errors do not expose request metadata', async () => {
  const { messages } = await collect(launch('error'));
  assert.equal(JSON.stringify(messages).includes('test-only-secret'), false);
  assert.equal(messages.at(-1).type, 'error');
});

test('worker accepts cancellation during a request', async () => {
  const worker = launch('wait');
  const result = collect(worker);
  setTimeout(() => worker.postMessage({ type: 'stop' }), 500);
  const { messages } = await result;
  assert.equal(
    messages.some(m => m.type === 'text'),
    false,
  );
});

test('tool calls go to the host, and the host outcome reaches the model', async () => {
  const { messages, requests } = await collect(launch('tool', [notesSave]), call => {
    assert.equal(call.name, 'notes_save');
    assert.deepEqual(call.input, { title: 'Groceries', body: '- milk' });
    return { status: 'denied', summary: 'You declined this action. Nothing was changed.' };
  });
  assert.equal(messages.filter(m => m.type === 'tool-call').length, 1);
  assert.equal(text(messages), 'Saved it.');
  assert.equal(messages.at(-1).type, 'done');

  // The model sees the tool it may call, then the host's outcome in the next turn.
  assert.equal(requests[0].tools[0].function.name, 'notes_save');
  const toolMessage = requests[1].messages.find(m => m.role === 'tool');
  assert.match(JSON.stringify(toolMessage), /denied/);
});

test('history and every screenshot reach the model, in order', async () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const { requests } = await collect(
    launch('success', [], {
      history: [{ prompt: 'Earlier question', reply: 'Earlier answer' }],
      screenshots: [
        { label: 'screen 1 of 2 — cursor is on this screen (primary focus)', jpeg },
        { label: 'screen 2 of 2', jpeg },
      ],
    }),
  );
  const [first, second, current] = requests[0].messages.filter(m => m.role !== 'system');
  assert.deepEqual([first.role, first.content], ['user', 'Earlier question']);
  assert.deepEqual([second.role, second.content], ['assistant', 'Earlier answer']);
  const parts = current.content;
  assert.equal(parts[0].text, 'Hello');
  assert.equal(parts.filter(p => p.type === 'image_url').length, 2);
  assert.match(parts.find(p => p.type === 'image_url').image_url.url, /^data:image\/jpeg;base64,/);
  assert.match(JSON.stringify(parts), /cursor is on this screen/);
});
