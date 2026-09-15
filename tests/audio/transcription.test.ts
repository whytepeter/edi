import assert from 'node:assert/strict';
import test from 'node:test';
import { pcmWave, transcribePcm } from '../../apps/desktop/src/main/voice/transcription-process';

test('WAV boundary produces fixed mono PCM16 and rejects malformed input', () => {
  const wav = pcmWave(new Uint8Array(32000));
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.readUInt32LE(24), 16000);
  assert.equal(wav.readUInt32LE(40), 32000);
  for (const pcm of [new Uint8Array(), new Uint8Array(3), new Uint8Array(1952002)]) {
    assert.throws(() => pcmWave(pcm));
  }
});
test('pre-aborted transcription does not spawn a process', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    transcribePcm(
      { executable: '/does-not-exist', model: '', vadModel: '' },
      new Uint8Array(32000),
      controller.signal,
    ),
    { name: 'AbortError' },
  );
});
test('missing local runtime fails cleanly', async () => {
  await assert.rejects(
    transcribePcm(
      { executable: '/does-not-exist', model: '', vadModel: '' },
      new Uint8Array(32000),
      new AbortController().signal,
    ),
    /could not start/,
  );
});

test('the warm server starts once for a warm-up and the first request, and stops on dispose', async () => {
  const { mkdtemp, writeFile, chmod, readFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { WhisperServer } = await import('../../apps/desktop/src/main/voice/transcription-server');
  const folder = await mkdtemp(join(tmpdir(), 'edi-whisper-'));
  const log = join(folder, 'starts.log');
  const fake = join(folder, 'whisper-server');
  // A stand-in server: records each start, answers like whisper.cpp.
  await writeFile(
    fake,
    `#!${process.execPath}
const http = require('node:http');
require('node:fs').appendFileSync(${JSON.stringify(log)}, 'start\\n');
const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
http.createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    res.end(req.method === 'POST' ? JSON.stringify({ text: ' Check my emails. ' }) : '{}');
  });
}).listen(port, '127.0.0.1');
`,
  );
  await chmod(fake, 0o755);
  const server = new WhisperServer({ executable: '/missing', model: 'm', vadModel: 'v' }, fake);
  server.warm();
  const words = await server.transcribe(new Uint8Array(32000), new AbortController().signal);
  assert.equal(words, 'Check my emails.');
  assert.equal(
    await server.transcribe(new Uint8Array(32000), new AbortController().signal),
    'Check my emails.',
  );
  assert.equal((await readFile(log, 'utf8')).trim().split('\n').length, 1);
  server.dispose();
});
