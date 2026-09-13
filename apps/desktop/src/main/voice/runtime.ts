import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PocketRuntime } from './pocket-process';
import type { ChatterboxRuntime } from './chatterbox-process';
import type { TranscriptionRuntime } from './transcription-process';

export interface VoiceRuntime {
  transcription: TranscriptionRuntime;
  pocket: PocketRuntime;
  chatterbox: ChatterboxRuntime | null;
}

/**
 * Locate the local voice runtimes. Development builds use the pinned, hash-verified
 * assets provisioned under `benchmarks/voice` (see benchmarks/voice/README.md).
 * Packaged builds return null until runtime bundling ships (milestone 0 open item),
 * and the character then says voice is unavailable instead of pretending to listen.
 */
export function resolveVoiceRuntime(appPath: string, packaged: boolean): VoiceRuntime | null {
  if (packaged) return null;
  const voice = resolve(appPath, '../../benchmarks/voice');
  const transcription = join(voice, 'cache/transcription');
  const build = existsSync(transcription)
    ? readdirSync(transcription).find(name => name.startsWith('whisper.cpp-'))
    : undefined;
  const runtime: VoiceRuntime = {
    transcription: {
      executable: join(transcription, build ?? 'missing', 'build/bin/whisper-cli'),
      model: existsSync(join(transcription, 'ggml-small.en.bin'))
        ? join(transcription, 'ggml-small.en.bin')
        : join(transcription, 'ggml-base.en.bin'),
      vadModel: join(transcription, 'ggml-silero-v6.2.0.bin'),
    },
    pocket: {
      python: join(voice, '.venv/bin/python'),
      worker: join(appPath, 'voice/pocket_worker.py'),
      cache: join(voice, 'cache/huggingface'),
    },
    chatterbox: null,
  };
  const chatterbox: ChatterboxRuntime = {
    python: join(voice, 'chatterbox-venv/bin/python'),
    worker: join(appPath, 'voice/chatterbox_worker.py'),
    cache: join(voice, 'cache/chatterbox'),
    model: join(voice, 'cache/chatterbox/model'),
  };
  if (Object.values(chatterbox).every(existsSync)) runtime.chatterbox = chatterbox;
  const paths = [...Object.values(runtime.transcription), ...Object.values(runtime.pocket)];
  return paths.every(path => existsSync(path)) ? runtime : null;
}
