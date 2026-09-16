// Real Chromium PCM capture with a synthetic stream: no physical microphone or upload.
import { _electron as electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(resolve('apps/desktop/package.json'));
const ts = require('typescript');
const source = await readFile('apps/desktop/src/renderer/src/features/voice/PcmCapture.ts', 'utf8');
const compiled = ts.transpileModule(source.replaceAll('export ', ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
let app;
try {
  const profile = await mkdtemp(join(tmpdir(), 'edi-capture-'));
  app = await electron.launch({
    executablePath: resolve(
      'apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
    ),
    args: [resolve('apps/desktop'), `--user-data-dir=${profile}`],
  });
  const page = await app.firstWindow();
  await page.evaluate(`${compiled}\nglobalThis.openTestCapture = openPcmCapture;`);
  const result = await page.evaluate(async () => {
    const context = new AudioContext();
    await context.resume();
    const oscillator = context.createOscillator();
    const destination = context.createMediaStreamDestination();
    oscillator.connect(destination); // Deliberately not connected to speakers.
    oscillator.start();
    const deps = {
      getUserMedia: async () => destination.stream,
      createContext: () => new AudioContext(),
    };
    const abort = new AbortController();
    try {
      const frames = [];
      const capture = await globalThis.openTestCapture(
        abort.signal,
        (pcm, rms) =>
          frames.push({ samples: pcm.length, rms, peak: Math.max(...pcm.map(Math.abs)) }),
        () => {},
        deps,
      );
      await new Promise(resolve => setTimeout(resolve, 600));
      capture.stop();
      const endedImmediately = destination.stream
        .getTracks()
        .every(track => track.readyState === 'ended');
      const count = frames.length;
      await new Promise(resolve => setTimeout(resolve, 100));
      const second = context.createMediaStreamDestination();
      oscillator.connect(second);
      const cancelled = new AbortController();
      const opening = globalThis.openTestCapture(
        cancelled.signal,
        () => {},
        () => {},
        {
          ...deps,
          getUserMedia: async () => second.stream,
        },
      );
      cancelled.abort();
      const discarded = await opening.then(
        () => false,
        error => error.name === 'AbortError',
      );
      await new Promise(resolve => setTimeout(resolve, 50));
      const cancelReleased = second.stream.getTracks().every(track => track.readyState === 'ended');
      oscillator.disconnect(second);
      return {
        source: 'synthetic oscillator, no microphone',
        frames: count,
        framesAfterStop: frames.length - count,
        samplesPerFrame: frames[0]?.samples,
        endedImmediately,
        discarded,
        cancelReleased,
        nonzero: frames.some(frame => frame.peak > 30 && frame.rms > 0.001),
      };
    } finally {
      abort.abort();
      oscillator.stop();
      oscillator.disconnect();
      destination.stream.getTracks().forEach(track => track.stop());
      await context.close();
    }
  });
  assert.equal(result.endedImmediately, true);
  assert.equal(result.discarded, true);
  assert.equal(result.cancelReleased, true);
  assert.equal(result.nonzero, true);
  assert.equal(result.samplesPerFrame, 320);
  assert.equal(result.framesAfterStop, 0);
  // About 600 ms of 20 ms frames, allowing for startup.
  assert.ok(result.frames > 15 && result.frames < 40, `frames: ${result.frames}`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await app?.close();
}
