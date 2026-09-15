import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PersonalVoices,
  wavFile,
  wavSamples,
} from '../../apps/desktop/src/main/voice/personal-voices';
import { voiceSelectionSchema } from '../../packages/contracts/src/index';

const folder = () => mkdtempSync(join(tmpdir(), 'edi-voices-'));

/** Seven seconds of speech from macOS's own voice, as an AIFF like a recording app would save. */
function spokenClip(dir: string, seconds = 'long') {
  const text =
    seconds === 'long'
      ? 'This is a recording for a new voice. It should be long enough to learn from, so I keep talking for a while longer.'
      : 'Too short.';
  const path = join(dir, `${seconds}.aiff`);
  execFileSync('/usr/bin/say', ['-v', 'Samantha', '-o', path, text]);
  return path;
}

test('a recording becomes a voice on this Mac: converted, trimmed, named and listed', async () => {
  const dir = folder();
  const trashed: string[] = [];
  const voices = new PersonalVoices(join(dir, 'voices'), {
    trash: async path => {
      trashed.push(path);
      rmSync(path);
    },
    now: () => 42,
  });
  let changes = 0;
  voices.onChange(() => changes++);

  const voice = await voices.add(spokenClip(dir), '  Edi ');
  assert.deepEqual(voice, { id: 'edi', name: 'Edi', addedAt: 42 });
  assert.equal(changes, 1);
  const samples = wavSamples(readFileSync(voices.recording('edi')));
  const seconds = samples.length / 2 / 24_000;
  assert.ok(seconds >= 6 && seconds <= 30, `kept ${seconds} s`);
  assert.deepEqual(await voices.list(), [voice]);

  // Same name again is refused; a different name that makes the same id gets its own id.
  await assert.rejects(voices.add(spokenClip(dir), 'edi'), /already have a voice called edi/);
  const other = await voices.add(spokenClip(dir), 'E.D.I 2');
  assert.match(other.id, /^edi[a-z]{4}$/);
  assert.ok(voiceSelectionSchema.safeParse({ model: 'chatterbox-turbo', voice: other.id }).success);

  await voices.remove('edi');
  assert.deepEqual(trashed, [voices.recording('edi')]);
  assert.deepEqual(
    (await voices.list()).map(entry => entry.id),
    [other.id],
  );
});

test('short or unreadable recordings are refused with a reason, and nothing is saved', async () => {
  const dir = folder();
  const voices = new PersonalVoices(join(dir, 'voices'), { trash: async () => {} });
  await assert.rejects(voices.add(spokenClip(dir, 'short'), 'Tiny'), /at least 6 seconds/);
  const notAudio = join(dir, 'notes.mp3');
  writeFileSync(notAudio, 'not audio at all');
  await assert.rejects(voices.add(notAudio, 'Notes'), /isn’t audio this Mac can read/);
  assert.deepEqual(await voices.list(), []);
  assert.equal(existsSync(join(dir, 'voices', 'voices.json')), false);
  // Names must be real names; ids can never be built-in voices or paths.
  await assert.rejects(voices.add(spokenClip(dir), '   '));
  assert.equal(
    voiceSelectionSchema.safeParse({ model: 'chatterbox-turbo', voice: '../calm' }).success,
    false,
  );
});

test('a recording placed before voices could be added is kept as the voice Edi', async () => {
  const dir = folder();
  const voiceFolder = join(dir, 'voices');
  const voices = new PersonalVoices(voiceFolder, { trash: async () => {} });
  execFileSync('mkdir', ['-p', voiceFolder]);
  writeFileSync(join(voiceFolder, 'edi.wav'), wavFile(Buffer.alloc(24_000 * 2 * 7)));
  assert.deepEqual(await voices.list(), [{ id: 'edi', name: 'Edi', addedAt: 0 }]);
  // Removing it writes the list, so the old recording can never bring it back.
  await voices.remove('edi');
  writeFileSync(join(voiceFolder, 'edi.wav'), wavFile(Buffer.alloc(24_000 * 2 * 7)));
  assert.deepEqual(await voices.list(), []);
});
