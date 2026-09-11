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
  const controller = new AbortController(); controller.abort();
  await assert.rejects(transcribePcm({ executable: '/does-not-exist', model: '', vadModel: '' },
    new Uint8Array(32000), controller.signal), { name: 'AbortError' });
});
test('missing local runtime fails cleanly', async () => {
  await assert.rejects(transcribePcm({ executable: '/does-not-exist', model: '', vadModel: '' },
    new Uint8Array(32000), new AbortController().signal), /could not start/);
});
