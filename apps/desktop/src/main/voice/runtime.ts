import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { MlxRuntime } from './mlx-process';
import type { TranscriptionRuntime } from './transcription-process';

export interface VoiceRuntime {
  transcription: TranscriptionRuntime;
  /** MLX engines; each model folder is null until provisioned. */
  mlx: (MlxRuntime & { kokoro: string | null; chatterbox: string | null }) | null;
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
    mlx: null,
  };
  // Provisioned by benchmarks/voice/provision_mlx.py. A model counts only if its weights exist.
  const mlx = {
    python: join(voice, 'mlx-venv/bin/python'),
    worker: join(appPath, 'voice/mlx_worker.py'),
    cache: join(voice, 'cache/mlx'),
  };
  const model = (folder: string, weights: string) =>
    existsSync(join(voice, 'cache/mlx', folder, weights)) ? join(voice, 'cache/mlx', folder) : null;
  if (Object.values(mlx).every(existsSync)) {
    runtime.mlx = {
      ...mlx,
      kokoro: model('kokoro', 'kokoro-v1_0.safetensors'),
      chatterbox: model('chatterbox-turbo-4bit', 'model.safetensors'),
    };
  }
  // Listening needs transcription; speech engines are optional and checked per model.
  return Object.values(runtime.transcription).every(path => existsSync(path)) ? runtime : null;
}
