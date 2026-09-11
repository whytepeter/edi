// Developer-only check. Uses an isolated app profile and a muted audio graph.
import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const require = createRequire(resolve('apps/desktop/package.json'));
const ts = require('typescript');
const source = await readFile('apps/desktop/src/renderer/src/audio/PcmPlayer.ts', 'utf8');
const compiled = ts.transpileModule(source.replace('export class', 'class'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const sample = await readFile('benchmarks/voice/results/pocket-run-02/greeting-0.wav');
const profile = await mkdtemp(join(tmpdir(), 'edi-audio-'));
let app;
try {
  app = await electron.launch({
    executablePath: resolve(
      'apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
    ),
    args: [resolve('apps/desktop'), `--user-data-dir=${profile}`],
  });
  await app.firstWindow();
  const page = app.windows()[0];
  await page.evaluate(`${compiled}\nglobalThis.EdiPcmPlayer = PcmPlayer;`);
  const report = await page.evaluate(
    async bytes => {
      const context = new AudioContext({ latencyHint: 'interactive' });
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      const mute = context.createGain();
      mute.gain.value = 0;
      analyser.connect(mute).connect(context.destination);
      const player = new globalThis.EdiPcmPlayer(context, analyser);
      const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
      const waitFor = async predicate => {
        const deadline = performance.now() + 15000;
        while (!predicate()) {
          if (performance.now() > deadline) throw new Error('Audio check timed out');
          await delay(10);
        }
      };
      const data = new Float32Array(analyser.fftSize);
      const peak = () => {
        analyser.getFloatTimeDomainData(data);
        return data.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
      };
      try {
        const audio = await context.decodeAudioData(new Uint8Array(bytes).buffer);
        const pcm = audio.getChannelData(0);
        const chunkSize = Math.round(audio.sampleRate * 0.08);
        const token = await player.begin();
        const start = performance.now();
        let firstSignalMs = null;
        let backpressureCount = 0;
        // Rechunk saved audio at 80 ms and feed every 20 ms. This is a repeatable
        // playback stress input, not a replay of Pocket's original chunk timings.
        for (let offset = 0; offset < pcm.length; offset += chunkSize) {
          const chunk = pcm.slice(offset, offset + chunkSize);
          while (player.push(token, chunk, audio.sampleRate) === 'backpressure') {
            backpressureCount += 1;
            await delay(20);
          }
          if (firstSignalMs === null && peak() > 0.001) firstSignalMs = performance.now() - start;
          await delay(20);
        }
        player.finish(token);
        await waitFor(() => player.snapshot().pendingNodes === 0);
        const fullPlayback = {
          ...player.snapshot(),
          elapsedMs: performance.now() - start,
          firstGraphSignalMs: firstSignalMs,
          backpressureCount,
        };

        const second = await player.begin();
        player.push(second, pcm.slice(0, audio.sampleRate), audio.sampleRate);
        player.push(second, pcm.slice(audio.sampleRate, audio.sampleRate * 2), audio.sampleRate);
        await waitFor(() => peak() > 0.001);
        const stopStart = performance.now();
        player.stop();
        const stopCallMs = performance.now() - stopStart;
        const staleResult = player.push(second, pcm.slice(0, chunkSize), audio.sampleRate);
        await waitFor(() => peak() === 0);
        const graphSilenceObservedMs = performance.now() - stopStart;
        await delay(200);
        const stayedSilent = peak() === 0;
        const interruption = {
          stopCallMs,
          graphSilenceObservedMs,
          staleResult,
          stayedSilent,
          ...player.snapshot(),
        };
        await player.dispose();
        return {
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          muted: true,
          source: 'Pocket run 2 greeting; synthetic 80 ms chunks / 20 ms arrival spacing',
          audibleLatencyMeasured: false,
          decodedSampleRate: audio.sampleRate,
          audioSeconds: audio.duration,
          baseLatency: context.baseLatency,
          fullPlayback,
          interruption,
          disposedState: context.state,
        };
      } finally {
        await player.dispose();
        analyser.disconnect();
        mute.disconnect();
      }
    },
    [...sample],
  );
  assert.equal(report.fullPlayback.schedulingGaps, 0);
  assert.equal(report.fullPlayback.pendingNodes, 0);
  assert.notEqual(report.fullPlayback.firstGraphSignalMs, null);
  assert.equal(report.interruption.staleResult, 'stale');
  assert.equal(report.interruption.pendingNodes, 0);
  assert.equal(report.interruption.stayedSilent, true);
  assert.equal(report.disposedState, 'closed');
  const root = resolve('benchmarks/voice/results');
  await mkdir(root, { recursive: true });
  const output = await mkdtemp(join(root, 'playback-'));
  await writeFile(join(output, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, ...report }, null, 2));
} finally {
  await app?.close();
}
