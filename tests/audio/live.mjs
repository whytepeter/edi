// Muted live Pocket → supervised process → renderer PCM player integration check.
import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { speakPocket } from '../../apps/desktop/src/main/voice/pocket-process.ts';

const require = createRequire(resolve('apps/desktop/package.json'));
const ts = require('typescript');
const source = await readFile('apps/desktop/src/renderer/src/audio/PcmPlayer.ts', 'utf8');
const compiled = ts.transpileModule(source.replace('export class', 'class'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const runtime = {
  python: resolve('benchmarks/voice/.venv/bin/python'),
  worker: resolve('apps/desktop/voice/pocket_worker.py'),
  cache: resolve('benchmarks/voice/cache/huggingface'),
};
const profile = await mkdtemp(join(tmpdir(), 'edi-live-audio-'));
const controller = new AbortController();
let app;
try {
  app = await electron.launch({
    executablePath: resolve('apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
    args: [resolve('apps/desktop'), `--user-data-dir=${profile}`],
  });
  const page = await app.firstWindow();
  await page.evaluate(`${compiled}\nglobalThis.EdiPcmPlayer = PcmPlayer;`);
  await page.evaluate(async () => {
    const context = new AudioContext();
    const mute = context.createGain();
    mute.gain.value = 0;
    mute.connect(context.destination);
    globalThis.player = new globalThis.EdiPcmPlayer(context, mute);
    globalThis.token = await globalThis.player.begin();
  });
  const started = performance.now();
  let firstPcmMs = null;
  let frames = 0;
  await speakPocket(runtime, 'Hello, I am Edi. What would you like to work on today?', controller.signal,
    async (pcm, rate) => {
      firstPcmMs ??= performance.now() - started;
      frames++;
      await page.evaluate(async ({ samples, rate }) => {
        while (globalThis.player.push(globalThis.token, new Float32Array(samples), rate) === 'backpressure') {
          await new Promise(resolve => setTimeout(resolve, 20));
        }
      }, { samples: [...pcm], rate });
    });
  const state = await page.evaluate(async () => {
    globalThis.player.finish(globalThis.token);
    const deadline = performance.now() + 15000;
    while (globalThis.player.snapshot().pendingNodes > 0) {
      if (performance.now() > deadline) throw new Error('Drain timed out');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    return globalThis.player.snapshot();
  });
  assert.ok(frames > 0);
  assert.equal(state.pendingNodes, 0);
  assert.equal(state.schedulingGaps, 0);
  await page.evaluate(async () => { globalThis.token = await globalThis.player.begin(); });
  const cancelled = new AbortController();
  let stopStarted;
  await assert.rejects(speakPocket(runtime, 'This response will stop before it finishes.', cancelled.signal,
    async (pcm, rate) => {
      await page.evaluate(({ samples, rate }) => {
        globalThis.player.push(globalThis.token, new Float32Array(samples), rate);
        globalThis.player.stop();
      }, { samples: [...pcm], rate });
      stopStarted = performance.now();
      cancelled.abort();
    }), /cancelled/);
  const stopToExitMs = performance.now() - stopStarted;
  const stopped = await page.evaluate(() => globalThis.player.snapshot());
  assert.equal(stopped.pendingNodes, 0);
  await page.evaluate(() => globalThis.player.dispose());
  const output = await mkdtemp(resolve('benchmarks/voice/results/live-'));
  const report = { muted: true, firstPcmMs, frames, state, stopToExitMs, stopped,
    includesModelStartup: true, acousticLatencyMeasured: false };
  await writeFile(join(output, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, ...report }, null, 2));
} finally {
  controller.abort();
  await app?.close();
}
