import { spawn } from 'node:child_process';

export interface TranscriptionRuntime {
  executable: string;
  model: string;
  vadModel: string;
}

/** Fixed-format boundary: 16 kHz mono signed PCM16 little-endian, at most 61 s. */
export function pcmWave(pcm: Uint8Array): Buffer {
  if (
    !(pcm instanceof Uint8Array) ||
    !pcm.byteLength ||
    pcm.byteLength % 2 ||
    pcm.byteLength > 16000 * 2 * 61
  ) {
    throw new Error('Invalid transcription audio');
  }
  const wav = Buffer.alloc(44 + pcm.byteLength);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + pcm.byteLength, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(pcm.byteLength, 40);
  wav.set(pcm, 44);
  return wav;
}

/** A single offline utterance. Paths belong to native configuration, never renderer input. */
export async function transcribePcm(
  runtime: TranscriptionRuntime,
  pcm: Uint8Array,
  signal: AbortSignal,
  timeoutMs = 30_000,
): Promise<string> {
  signal.throwIfAborted();
  const wav = pcmWave(pcm);
  return new Promise((resolve, reject) => {
    const child = spawn(
      runtime.executable,
      [
        '-m',
        runtime.model,
        '--vad',
        '-vm',
        runtime.vadModel,
        '-f',
        '-',
        '-l',
        'en',
        '--prompt',
        'Edi. Fewer Labs. OpenRouter. MCP. OAuth. Lagos. Abuja. Naira.',
        '-t',
        '4',
        '-ng',
        '-np',
        '-nt',
        '-otxt',
        '-of',
        '-',
      ],
      {
        stdio: ['pipe', 'pipe', 'ignore'],
        env: { PATH: '/usr/bin:/bin' },
      },
    );
    let failure: Error | undefined;
    const output: Buffer[] = [];
    let size = 0;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const fail = (message: string) => {
      failure ??= new Error(message);
      child.kill('SIGTERM');
      killTimer ??= setTimeout(() => child.kill('SIGKILL'), 1000);
    };
    const abort = () => fail('Transcription cancelled');
    signal.addEventListener('abort', abort, { once: true });
    const deadline = setTimeout(() => fail('Transcription timed out'), timeoutMs);
    child.on('error', () => fail('Transcription process could not start'));
    child.stdin.on('error', () => fail('Transcription input failed'));
    child.stdout.on('data', (data: Buffer) => {
      size += data.length;
      if (size > 32000) {
        fail('Transcription output limit exceeded');
        return;
      }
      output.push(data);
    });
    child.on('close', code => {
      clearTimeout(deadline);
      clearTimeout(killTimer);
      signal.removeEventListener('abort', abort);
      wav.fill(0);
      if (failure || code !== 0) {
        reject(failure ?? new Error('Transcription failed'));
        return;
      }
      const text = Buffer.concat(output).toString('utf8').trim();
      if (text.length > 8000) {
        reject(new Error('Transcript too long'));
        return;
      }
      // Empty VAD output is a no-speech result, never a prompt or an error.
      resolve(text);
    });
    if (signal.aborted) abort();
    else child.stdin.end(wav);
  });
}
