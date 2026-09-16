import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from '../../packages/capabilities/node_modules/zod/index.js';
import {
  CapabilityBroker,
  DIRECT_APP_TOOLS,
  defineCapability,
  type Capability,
} from '../../packages/capabilities/src/index';
import {
  MAX_ACTIVE_FOUND,
  activate,
  findAppTools,
} from '../../apps/desktop/src/main/agent/app-tool-search';
import { workerInputSchema } from '../../apps/desktop/src/main/agent/worker-protocol';

const appTool = (app: string, name: string, description: string): Capability =>
  defineCapability({
    id: `mcp_${app.toLowerCase()}.${name}`,
    app,
    title: `${app}: ${name}`,
    description,
    effect: 'read',
    input: z.object({}),
    timeoutMs: 1_000,
    prepare: () => ({
      preview: { title: name, action: 'Allow', summary: name, fields: [] },
      execute: async () => ({ summary: 'done' }),
    }),
  });

const builtIn = defineCapability({
  id: 'notes.save',
  title: 'Save note',
  description: 'Save a note.',
  effect: 'write',
  input: z.object({}),
  timeoutMs: 1_000,
  prepare: () => ({
    preview: { title: 'Save', action: 'Save', summary: 'Save', fields: [] },
    execute: async () => ({ summary: 'saved' }),
  }),
});

const brokerWith = (extra: Capability[]) =>
  new CapabilityBroker(
    [builtIn],
    {
      approvals: { request: async () => 'approved' },
      recorder: { created() {}, decided() {}, finished() {} },
    },
    () => extra,
  );

test('connected-app tools are sent directly until there are too many, then only found by search', () => {
  const few = Array.from({ length: DIRECT_APP_TOOLS }, (_, n) => appTool('Gmail', `t${n}`, 'x'));
  const direct = brokerWith(few).manifest();
  assert.equal(direct.filter(entry => entry.deferred).length, 0);
  assert.equal(direct.find(entry => entry.name === 'mcp_gmail_t0')?.app, 'Gmail');

  const many = [...few, appTool('Slack', 'send_message', 'Send a message.')];
  const manifest = brokerWith(many).manifest();
  assert.equal(manifest.filter(entry => entry.deferred).length, DIRECT_APP_TOOLS + 1);
  // Built-in tools are always offered.
  assert.equal(manifest.find(entry => entry.name === 'notes_save')?.deferred, undefined);
});

test('search finds app tools by name, app and description words', () => {
  const tools = [
    { name: 'mcp_gmail.gmail_send_email', app: 'Gmail', description: 'Send an email.' },
    { name: 'mcp_gmail.gmail_fetch_emails', app: 'Gmail', description: 'Fetch emails.' },
    { name: 'mcp_slack.slack_send_message', app: 'Slack', description: 'Post to a channel.' },
    { name: 'mcp_linear.list_issues', app: 'Linear', description: 'List issues in a team.' },
  ];
  assert.deepEqual(
    findAppTools(tools, 'send gmail email').map(tool => tool.name),
    ['mcp_gmail.gmail_send_email', 'mcp_gmail.gmail_fetch_emails', 'mcp_slack.slack_send_message'],
  );
  assert.deepEqual(
    findAppTools(tools, 'Linear issues').map(tool => tool.name),
    ['mcp_linear.list_issues'],
  );
  assert.deepEqual(findAppTools(tools, 'weather'), []);
  assert.deepEqual(findAppTools(tools, '  '), []);
});

test('found tools stay active up to a limit, newest kept', () => {
  const active = new Set<string>();
  activate(active, ['a', 'b']);
  activate(active, ['a']);
  assert.deepEqual([...active], ['b', 'a']);
  activate(
    active,
    Array.from({ length: MAX_ACTIVE_FOUND }, (_, n) => `t${n}`),
  );
  assert.equal(active.size, MAX_ACTIVE_FOUND);
  assert.ok(!active.has('b') && !active.has('a'));
});

test('a run may declare many deferred tools but only a bounded number directly', () => {
  const entry = (name: string, deferred?: boolean) => ({
    name,
    description: 'x',
    inputSchema: { type: 'object' },
    ...(deferred ? { app: 'Gmail', deferred } : {}),
  });
  const base = { apiKey: 'sk-or-0123456789', model: 'google/gemini-flash', prompt: 'hi' };
  const run = (tools: ReturnType<typeof entry>[]) =>
    workerInputSchema.safeParse({ ...base, history: [], screenshots: [], spoken: false, tools });
  const builtIns = Array.from({ length: 40 }, (_, n) => entry(`b${n}`));
  const apps = Array.from({ length: 300 }, (_, n) => entry(`a${n}`, true));
  assert.equal(run([...builtIns, ...apps]).success, true);
  assert.equal(run(Array.from({ length: 91 }, (_, n) => entry(`d${n}`))).success, false);
});
