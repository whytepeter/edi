import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from '../../packages/capabilities/node_modules/zod/index.js';
import { defineCapability, type Capability } from '../../packages/capabilities/src/index';
import { createRepositories, openDatabase } from '../../packages/storage/src/index';
import { TaskService, type WorkerLike } from '../../apps/desktop/src/main/agent/task-service';
import type { HostMessage, WorkerInput } from '../../apps/desktop/src/main/agent/worker-protocol';
import type { OpenRouterCredentials } from '../../apps/desktop/src/main/agent/credentials';

/** A worker the test drives: it records what the host sends and lets the test speak for it. */
class FakeWorker implements WorkerLike {
  sent: HostMessage[] = [];
  private listeners: Record<string, ((message?: unknown) => void)[]> = {};
  constructor(readonly data: WorkerInput) {}
  on(event: string, listener: (message?: unknown) => void) {
    (this.listeners[event] ??= []).push(listener);
    return this;
  }
  postMessage(message: HostMessage) {
    this.sent.push(message);
  }
  terminate() {}
  emit(message: unknown) {
    for (const listener of this.listeners.message ?? []) listener(message);
  }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 20));
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const usage = (costUsd: number) => ({
  type: 'usage',
  entry: {
    kind: 'answer',
    provider: 'openrouter',
    model: 'test/model',
    inputTokens: 10,
    outputTokens: 5,
    cachedTokens: 0,
    costUsd,
    characters: 0,
  },
});

function harness(capabilities: Capability[] = []) {
  const repositories = createRepositories(openDatabase(':memory:'));
  const workers: FakeWorker[] = [];
  const finished: string[] = [];
  const credentials = {
    configured: true,
    apiKey: 'test-key-123',
    model: 'test/model',
  } as OpenRouterCredentials;
  const tasks = new TaskService({
    credentials,
    repositories,
    capabilities,
    maxRunning: 2,
    createWorker: data => {
      const worker = new FakeWorker(data);
      workers.push(worker);
      return worker;
    },
    finished: task => finished.push(`${task.title}:${task.status}`),
  });
  return { repositories, workers, finished, tasks };
}

test('a task cut off by a quit can be asked again, and starts afresh', () => {
  const { tasks, repositories } = harness();
  const first = tasks.start({
    prompt: 'Check the shipping status',
    budgetUsd: 0.5,
    conversationId: null,
  });
  // Edi quit while it was working, and started again.
  repositories.tasks.recover(50);
  assert.equal(tasks.task(first.id)?.status, 'interrupted');

  const again = tasks.retry(first.id);
  assert.notEqual(again.id, first.id);
  assert.equal(again.prompt, 'Check the shipping status');
  // The old one keeps its own history; nothing it did is repeated.
  assert.equal(tasks.task(first.id)?.status, 'interrupted');
  assert.equal(tasks.list().length, 2);
  assert.throws(() => tasks.retry(uuid(999)), /no longer exists/);
});

test('two tasks run at once, the next waits its turn, and a result is kept', async () => {
  const { tasks, workers, finished } = harness();
  const first = tasks.start({
    prompt: 'Find frontend roles',
    budgetUsd: 0.5,
    conversationId: null,
  });
  tasks.start({ prompt: 'Summarize the news', budgetUsd: 0.5, conversationId: null });
  const third = tasks.start({ prompt: 'Plan the week', budgetUsd: 0.5, conversationId: null });
  assert.equal(workers.length, 2);
  assert.equal(tasks.task(third.id)?.status, 'queued');
  assert.equal(workers[0]!.data.mode, 'task');
  assert.equal(workers[0]!.data.maxSteps, 25);

  workers[0]!.emit({ type: 'text', text: 'Found 3 roles.' });
  workers[0]!.emit({ type: 'done' });
  assert.equal(tasks.task(first.id)?.status, 'done');
  assert.equal(tasks.task(first.id)?.result, 'Found 3 roles.');
  assert.deepEqual(finished, ['Find frontend roles:done']);
  assert.equal(workers.length, 3);
  assert.equal(tasks.task(third.id)?.status, 'running');
});

test('at its cap a task pauses before its next step and carries on when allowed more', async () => {
  const read = defineCapability({
    id: 'web.fetch',
    title: 'Read a web page',
    description: 'Read',
    effect: 'read',
    timeoutMs: 1000,
    input: z.object({ url: z.string() }).strict(),
    prepare: () => ({
      preview: { title: 'Read', action: 'Read', summary: 'Read.', fields: [] },
      execute: async () => ({ summary: 'Read the page.' }),
    }),
  });
  const { tasks, workers, repositories } = harness([read as Capability]);
  const task = tasks.start({ prompt: 'Research', budgetUsd: 0.1, conversationId: null });
  const worker = workers[0]!;
  worker.emit(usage(0.06));
  assert.equal(tasks.task(task.id)?.status, 'running');
  worker.emit(usage(0.05));
  assert.equal(tasks.task(task.id)?.status, 'limited');
  assert.match(tasks.task(task.id)!.progress, /Reached its \$0\.10 cap/);

  worker.emit({
    type: 'tool-call',
    id: uuid(1),
    name: 'web_fetch',
    input: { url: 'https://a.example' },
  });
  await settle();
  assert.equal(worker.sent.filter(message => message.type === 'tool-result').length, 0);

  tasks.raiseBudget(task.id, 0.5);
  assert.equal(tasks.task(task.id)?.status, 'running');
  assert.equal(repositories.tasks.get(task.id)?.budgetUsd, 0.6);
  assert.equal(worker.sent.filter(message => message.type === 'tool-result').length, 1);
});

test('a review pauses the task; always allowing it covers the rest of that task', async () => {
  let moved = 0;
  const move = defineCapability({
    id: 'files.move',
    title: 'Move files',
    description: 'Move',
    effect: 'write',
    timeoutMs: 1000,
    input: z.object({ to: z.string() }).strict(),
    prepare: ({ to }) => ({
      preview: { title: 'Move', action: 'Move', summary: `Move to ${to}.`, fields: [] },
      execute: async () => {
        moved++;
        return { summary: 'Moved.' };
      },
    }),
  });
  const { tasks, workers } = harness([move as Capability]);
  const task = tasks.start({ prompt: 'Tidy Downloads', budgetUsd: 0.5, conversationId: null });
  const worker = workers[0]!;
  worker.emit({ type: 'tool-call', id: uuid(1), name: 'files_move', input: { to: 'a' } });
  await settle();
  const waiting = tasks.task(task.id)!;
  assert.equal(waiting.status, 'waiting');
  assert.equal(waiting.approval?.capability.id, 'files.move');
  tasks.respondToApproval(waiting.approval!.callId, 'approve-always');
  await settle();
  assert.equal(tasks.task(task.id)?.status, 'running');
  worker.emit({ type: 'tool-call', id: uuid(2), name: 'files_move', input: { to: 'b' } });
  await settle();
  assert.equal(moved, 2);
  assert.equal(tasks.currentApproval, null);
  assert.deepEqual(
    tasks.task(task.id)!.steps.map(step => step.status),
    ['succeeded', 'succeeded'],
  );
});

test('a schedule that runs on its own adds reminders without asking, and still waits for the rest', async () => {
  let added = 0;
  const addReminders = defineCapability({
    id: 'reminders.create',
    title: 'Add reminders',
    description: 'Add reminders',
    effect: 'write',
    timeoutMs: 1000,
    input: z.object({ title: z.string() }).strict(),
    prepare: ({ title }) => ({
      preview: { title: 'Add reminders', action: 'Add', summary: `Add ${title}.`, fields: [] },
      execute: async () => {
        added++;
        return { summary: 'Added.' };
      },
    }),
  });
  const trash = defineCapability({
    id: 'files.trash',
    title: 'Move to Trash',
    description: 'Trash',
    effect: 'write',
    timeoutMs: 1000,
    input: z.object({ path: z.string() }).strict(),
    prepare: ({ path }) => ({
      preview: { title: 'Move to Trash', action: 'Trash', summary: `Trash ${path}.`, fields: [] },
      execute: async () => ({ summary: 'Trashed.' }),
    }),
  });
  const { tasks, workers, repositories } = harness([
    addReminders as Capability,
    trash as Capability,
  ]);
  repositories.schedules.create({
    id: uuid(300),
    title: 'Daily reminders',
    prompt: 'Add my reminders',
    when: { kind: 'daily', time: '08:00' },
    notify: 'always',
    budgetUsd: 0.5,
    enabled: true,
    unattended: true,
    createdAt: 1,
    nextRunAt: 2,
  });
  const task = tasks.start({
    prompt: 'Add my reminders',
    budgetUsd: 0.5,
    conversationId: null,
    scheduleId: uuid(300),
  });
  const worker = workers[0]!;
  worker.emit({ type: 'tool-call', id: uuid(1), name: 'reminders_create', input: { title: 'Standup' } });
  await settle();
  assert.equal(added, 1, 'nobody had to be there');
  assert.equal(tasks.currentApproval, null);
  assert.equal(tasks.task(task.id)?.status, 'running');

  // Moving files to the Trash is not on that list, so it still waits for the person.
  worker.emit({ type: 'tool-call', id: uuid(2), name: 'files_trash', input: { path: '~/a.txt' } });
  await settle();
  assert.equal(tasks.task(task.id)?.status, 'waiting');
  assert.equal(tasks.currentApproval?.capability.id, 'files.trash');
});

test('stopping ends a running or queued task; a restart interrupts what was running', () => {
  const { tasks, workers, repositories } = harness();
  const one = tasks.start({ prompt: 'One', budgetUsd: 0.5, conversationId: null });
  tasks.start({ prompt: 'Two', budgetUsd: 0.5, conversationId: null });
  const three = tasks.start({ prompt: 'Three', budgetUsd: 0.5, conversationId: null });
  tasks.stop(three.id);
  assert.equal(tasks.task(three.id)?.status, 'cancelled');
  tasks.stop(one.id);
  assert.equal(tasks.task(one.id)?.status, 'cancelled');
  assert.ok(workers[0]!.sent.some(message => message.type === 'stop'));

  // Simulate quitting with task Two mid-run, then launching again.
  const restarted = new TaskService({
    credentials: {
      configured: true,
      apiKey: 'test-key-123',
      model: 'test/model',
    } as OpenRouterCredentials,
    repositories,
    capabilities: [],
    createWorker: data => new FakeWorker(data),
  });
  restarted.resume();
  assert.deepEqual(
    restarted
      .list()
      .map(task => [task.prompt, task.status])
      .sort((a, b) => a[0]!.localeCompare(b[0]!)),
    [
      ['One', 'cancelled'],
      ['Three', 'cancelled'],
      ['Two', 'interrupted'],
    ],
  );
});
