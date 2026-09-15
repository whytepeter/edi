// Synthetic speech → live 16 kHz PCM capture → local VAD/transcription.
import { _electron as electron } from '@playwright/test';
import { readFile, mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { transcribePcm } from '../../apps/desktop/src/main/voice/transcription-process.ts';

const require = createRequire(resolve('apps/desktop/package.json'));
const ts = require('typescript');
const runtimeRoot = resolve('benchmarks/voice/cache/transcription');
const runtime = {
  executable: join(
    runtimeRoot,
    'whisper.cpp-927cfce34f31707e17f2bff35c349632fb9e2c3a/build/bin/whisper-cli',
  ),
  model: join(runtimeRoot, 'ggml-base.en.bin'),
  vadModel: join(runtimeRoot, 'ggml-silero-v6.2.0.bin'),
};
let compiled = '';
for (const name of ['PcmCapture']) {
  const text = await readFile(`apps/desktop/src/renderer/src/features/voice/${name}.ts`, 'utf8');
  compiled += ts.transpileModule(text.replaceAll('export ', ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
}
const sample = await readFile('benchmarks/voice/results/pocket-run-02/greeting-0.wav');
const profile = await mkdtemp(join(tmpdir(), 'edi-transcription-'));
let app;
try {
  app = await electron.launch({
    executablePath: resolve(
      'apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
    ),
    args: [resolve('apps/desktop'), `--user-data-dir=${profile}`],
  });
  const page = await app.firstWindow();
  await page.evaluate(`${compiled}\nglobalThis.testCapture = openPcmCapture;`);
  const audio = await page.evaluate(
    async bytes => {
      const context = new AudioContext();
      await context.resume();
      const stream = context.createMediaStreamDestination();
      const source = context.createBufferSource();
      source.buffer = await context.decodeAudioData(new Uint8Array(bytes).buffer);
      source.connect(stream); // No speaker or physical microphone connection.
      const controller = new AbortController();
      try {
        const chunks = [];
        const capture = await globalThis.testCapture(
          controller.signal,
          pcm => chunks.push(new Uint8Array(pcm.buffer.slice(0))),
          () => {},
          {
            getUserMedia: async () => stream.stream,
            createContext: () => new AudioContext({ sampleRate: 16000 }),
          },
        );
        await new Promise(resolve => {
          source.onended = resolve;
          source.start();
        });
        await new Promise(resolve => setTimeout(resolve, 150));
        capture.stop();
        const pcm = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
        let offset = 0;
        for (const chunk of chunks) {
          pcm.set(chunk, offset);
          offset += chunk.length;
        }
        return {
          pcm: [...pcm],
          recordedBytes: pcm.length,
          tracksEnded: stream.stream.getTracks().every(track => track.readyState === 'ended'),
        };
      } finally {
        controller.abort();
        source.disconnect();
        stream.stream.getTracks().forEach(track => track.stop());
        await context.close();
      }
    },
    [...sample],
  );
  assert.equal(audio.tracksEnded, true);
  const started = performance.now();
  const transcript = await transcribePcm(
    runtime,
    new Uint8Array(audio.pcm),
    new AbortController().signal,
  );
  const transcriptionMs = performance.now() - started;
  assert.match(transcript, /what are we working on today/i);
  const silence = await transcribePcm(runtime, new Uint8Array(96000), new AbortController().signal);
  assert.equal(silence, '');
  const controller = new AbortController();
  const cancelTimer = setTimeout(() => controller.abort(), 20);
  try {
    await assert.rejects(
      transcribePcm(runtime, new Uint8Array(audio.pcm), controller.signal),
      /cancelled/,
    );
  } finally {
    clearTimeout(cancelTimer);
  }
  console.log(
    JSON.stringify(
      {
        transcript,
        transcriptionMs,
        recordedBytes: audio.recordedBytes,
        tracksEnded: audio.tracksEnded,
        silenceRejected: silence === '',
        runningCancellationPassed: true,
        physicalMicrophone: false,
        cloudCalls: 0,
      },
      null,
      2,
    ),
  );
} finally {
  await app?.close();
}
