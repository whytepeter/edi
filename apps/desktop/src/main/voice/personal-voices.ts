import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  personalVoiceListSchema,
  personalVoiceNameSchema,
  type PersonalVoice,
} from '@edi/contracts';

const RATE = 24_000;
/** Chatterbox needs more than five seconds; it listens to the first 15 of a recording. */
const MIN_SECONDS = 6;
const KEEP_SECONDS = 30;
const MAX_SOURCE_BYTES = 200 * 1024 * 1024;
const MAX_VOICES = 20;
export const RECORDING_EXTENSIONS = ['wav', 'aif', 'aiff', 'm4a', 'mp3', 'caf', 'flac'];

export interface PersonalVoiceDependencies {
  /** Any audio file → 24 kHz mono 16-bit WAV. macOS's afconvert by default. */
  convert?(source: string, target: string): Promise<void>;
  trash(path: string): Promise<void>;
  now?(): number;
}

const afconvert = (source: string, target: string) =>
  new Promise<void>((resolve, reject) => {
    execFile(
      '/usr/bin/afconvert',
      ['-f', 'WAVE', '-d', `LEI16@${RATE}`, '-c', '1', source, target],
      { timeout: 60_000, env: { PATH: '/usr/bin:/bin' } },
      error => (error ? reject(new Error('That file isn’t audio this Mac can read.')) : resolve()),
    );
  });

/** The PCM samples of a 16-bit mono WAV, found by walking its chunks (afconvert pads some). */
export function wavSamples(bytes: Buffer) {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error('That file isn’t audio this Mac can read.');
  let format: { channels: number; rate: number; bits: number } | undefined;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const id = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ')
      format = {
        channels: bytes.readUInt16LE(body + 2),
        rate: bytes.readUInt32LE(body + 4),
        bits: bytes.readUInt16LE(body + 14),
      };
    if (id === 'data') {
      if (!format || format.channels !== 1 || format.rate !== RATE || format.bits !== 16)
        throw new Error('That file isn’t audio this Mac can read.');
      const end = Math.min(bytes.length, body + size);
      return bytes.subarray(body, end - ((end - body) % 2));
    }
    offset = body + size + (size % 2);
  }
  throw new Error('That file isn’t audio this Mac can read.');
}

export function wavFile(samples: Buffer) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + samples.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(samples.length, 40);
  return Buffer.concat([header, samples]);
}

/** A short lowercase id from the name ("Edi" → "edi"), never one of the built-in voices. */
function voiceId(name: string, taken: Set<string>) {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z]/g, '')
      .slice(0, 14) || 'voice';
  let id = base.length >= 2 ? base : `${base}voice`;
  while (taken.has(id) || id === 'calm' || id === 'turbo') {
    const letters = [...randomBytes(4)].map(byte => String.fromCharCode(97 + (byte % 26))).join('');
    id = `${base.slice(0, 14)}${letters}`;
  }
  return id;
}

/**
 * Chatterbox voices the person added from their own recordings. Everything stays in this
 * folder on this Mac (never in the app, never uploaded): one WAV per voice plus voices.json
 * with their names. Adding requires the person to confirm the voice is theirs or that its
 * speaker agreed; removing moves the recording to the Trash.
 */
export class PersonalVoices {
  private listeners = new Set<() => void>();

  constructor(
    private readonly folder: string,
    private readonly deps: PersonalVoiceDependencies,
  ) {}

  private get index() {
    return join(this.folder, 'voices.json');
  }

  recording(id: string) {
    return join(this.folder, `${id}.wav`);
  }

  async list(): Promise<PersonalVoice[]> {
    // Before any voice was added in Settings there is no list: a recording already placed as
    // "edi.wav" is kept as the voice Edi. Once a list exists, it alone decides.
    const saved = existsSync(this.index)
      ? await readFile(this.index, 'utf8')
          .then(text => personalVoiceListSchema.parse(JSON.parse(text)))
          .catch((): PersonalVoice[] => [])
      : existsSync(this.recording('edi'))
        ? [{ id: 'edi', name: 'Edi', addedAt: 0 }]
        : [];
    return saved.filter(voice => existsSync(this.recording(voice.id)));
  }

  async add(source: string, rawName: string): Promise<PersonalVoice> {
    const name = personalVoiceNameSchema.parse(rawName);
    const voices = await this.list();
    if (voices.length >= MAX_VOICES) throw new Error(`You can keep up to ${MAX_VOICES} voices.`);
    if (voices.some(voice => voice.name.toLowerCase() === name.toLowerCase()))
      throw new Error(`You already have a voice called ${name}.`);
    const size = (await stat(source)).size;
    if (size > MAX_SOURCE_BYTES) throw new Error('That recording is too large. Use a shorter one.');

    const converted = join(tmpdir(), `edi-voice-${randomBytes(6).toString('hex')}.wav`);
    try {
      await (this.deps.convert ?? afconvert)(source, converted);
      const samples = wavSamples(await readFile(converted));
      const seconds = samples.length / 2 / RATE;
      if (seconds < MIN_SECONDS)
        throw new Error(
          `That recording is ${seconds.toFixed(1)} seconds. Use at least ${MIN_SECONDS} seconds of clear speech.`,
        );
      const id = voiceId(name, new Set(voices.map(voice => voice.id)));
      mkdirSync(this.folder, { recursive: true });
      const target = this.recording(id);
      const partial = `${target}.partial`;
      await writeFile(partial, wavFile(samples.subarray(0, KEEP_SECONDS * RATE * 2)));
      await rename(partial, target);
      const voice: PersonalVoice = { id, name, addedAt: (this.deps.now ?? Date.now)() };
      await this.save([...voices, voice]);
      return voice;
    } finally {
      await rm(converted, { force: true });
    }
  }

  async remove(id: string) {
    const voices = await this.list();
    if (!voices.some(voice => voice.id === id)) return;
    await this.deps.trash(this.recording(id));
    await this.save(voices.filter(voice => voice.id !== id));
  }

  onChange(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async save(voices: PersonalVoice[]) {
    mkdirSync(this.folder, { recursive: true });
    const partial = `${this.index}.partial`;
    await writeFile(partial, JSON.stringify(voices, null, 2));
    await rename(partial, this.index);
    for (const listener of this.listeners) listener();
  }
}
