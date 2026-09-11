// Real Chromium recording with a synthetic stream: no physical microphone or upload.
import { _electron as electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(resolve('apps/desktop/package.json'));
const ts = require('typescript');
const source = await readFile('apps/desktop/src/renderer/src/audio/MicrophoneCapture.ts', 'utf8');
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
  await page.evaluate(`${compiled}\nglobalThis.openTestCapture = openMicrophone;`);
  const result = await page.evaluate(async () => {
    const context = new AudioContext();
    await context.resume();
    const oscillator = context.createOscillator();
    const destination = context.createMediaStreamDestination();
    oscillator.connect(destination); // Deliberately not connected to speakers.
    oscillator.start();
    const deps = {
      getUserMedia: async () => destination.stream,
      createRecorder: stream => new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' }),
    };
    const abort = new AbortController();
    try {
      const turn = await globalThis.openTestCapture(abort.signal, deps);
      await new Promise(resolve => setTimeout(resolve, 600));
      turn.finish();
      const endedImmediately = destination.stream
        .getTracks()
        .every(track => track.readyState === 'ended');
      const blob = await turn.result;
      const decoded = await context.decodeAudioData(await blob.arrayBuffer());
      const second = context.createMediaStreamDestination();
      oscillator.connect(second);
      const cancelled = new AbortController();
      const secondTurn = await globalThis.openTestCapture(cancelled.signal, {
        ...deps,
        getUserMedia: async () => second.stream,
      });
      cancelled.abort();
      const discarded = (await secondTurn.result) === null;
      const cancelReleased = second.stream.getTracks().every(track => track.readyState === 'ended');
      oscillator.disconnect(second);
      return {
        source: 'synthetic oscillator, no microphone',
        bytes: blob.size,
        mimeType: blob.type,
        decodedSeconds: decoded.duration,
        endedImmediately,
        discarded,
        cancelReleased,
        nonzero: decoded.getChannelData(0).some(sample => Math.abs(sample) > 0.001),
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
  assert.ok(result.bytes > 0);
  assert.ok(result.decodedSeconds > 0.3 && result.decodedSeconds < 2);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await app?.close();
}
