import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { ChildProcess, spawn as spawnType } from 'node:child_process';
import { LocalRunner } from '../../apps/desktop/src/main/agent/local-runner';
import type { ModelPacks } from '../../apps/desktop/src/main/agent/model-packs';

/** A started program that never really ran: it records its arguments and can be killed. */
function fakeSpawn() {
  const started: { command: string; args: string[] }[] = [];
  const children: (ChildProcess & { killed?: string })[] = [];
  const spawn = ((command: string, args: string[]) => {
    started.push({ command, args });
    const child = new EventEmitter() as ChildProcess & { killed?: string };
    Object.assign(child, {
      exitCode: null,
      kill: (signal: string) => {
        child.killed ??= signal;
        return true;
      },
    });
    children.push(child);
    return child;
  }) as unknown as typeof spawnType;
  return { spawn, started, children };
}

/** Two packs, both downloaded, as ModelPacks reports them. */
const packs = {
  installedPacks: () => [
    {
      id: 'language-small' as const,
      modelPath: '/models/llm/small.gguf',
      mmprojPath: '/models/llm/small-mmproj.gguf',
      contextLength: 8192,
    },
    {
      id: 'language-standard' as const,
      modelPath: '/models/llm/standard.gguf',
      mmprojPath: '/models/llm/standard-mmproj.gguf',
      contextLength: 16_384,
    },
  ],
} as unknown as ModelPacks;

/** Answers /health as a model that is still loading, then as one that is ready. */
function health(readyAfter: number) {
  let asked = 0;
  return (async () => {
    asked += 1;
    return new Response('{}', { status: asked > readyAfter ? 200 : 503 });
  }) as unknown as typeof fetch;
}

test('the runner serves one downloaded model on a loopback port, and waits for it to load', async () => {
  const { spawn, started } = fakeSpawn();
  const runner = new LocalRunner({
    server: '/Applications/Edi.app/Contents/Resources/llama/llama-server',
    packs,
    spawn,
    fetch: health(1),
  });
  assert.equal(runner.available, true);

  const base = await runner.serve('language-small');
  assert.match(base ?? '', /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(started.length, 1);
  const args = started[0]!.args;
  assert.deepEqual(args.slice(0, 4), [
    '-m',
    '/models/llm/small.gguf',
    '--mmproj',
    '/models/llm/small-mmproj.gguf',
  ]);
  assert.deepEqual(args.slice(4, 6), ['-c', '8192']);
  // Nothing to browse to, and the address is this Mac only.
  assert.ok(args.includes('--no-webui'));
  assert.equal(args[args.indexOf('--host') + 1], '127.0.0.1');
  assert.equal(args[args.indexOf('--port') + 1], base!.split(':')[2]);

  // Asking again reuses the model that is already loaded.
  assert.equal(await runner.serve('language-small'), base);
  assert.equal(started.length, 1);
  runner.stop();
});

test('another model replaces the one loaded, and an idle model gives its memory back', async () => {
  const { spawn, started, children } = fakeSpawn();
  const runner = new LocalRunner({ server: '/llama-server', packs, spawn, fetch: health(0) });

  await runner.serve('language-small');
  await runner.serve('language-standard');
  assert.equal(started.length, 2);
  assert.equal(started[1]!.args[1], '/models/llm/standard.gguf');
  assert.equal(children[0]!.killed, 'SIGTERM');

  // Idle: the model unloads on its own.
  const idle = new LocalRunner({
    server: '/llama-server',
    packs,
    spawn,
    fetch: health(0),
    idleMs: 5,
  });
  await idle.serve('language-small');
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(children.at(-1)!.killed, 'SIGTERM');
});

test('without the runner, or without the model downloaded, nothing is served', async () => {
  const { spawn, started } = fakeSpawn();
  const none = new LocalRunner({ server: null, packs, spawn, fetch: health(0) });
  assert.equal(none.available, false);
  assert.equal(await none.serve('language-small'), null);

  const empty = new LocalRunner({
    server: '/llama-server',
    packs: { installedPacks: () => [] } as unknown as ModelPacks,
    spawn,
    fetch: health(0),
  });
  assert.equal(await empty.serve('language-small'), null);
  assert.equal(started.length, 0);
});
