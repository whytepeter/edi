import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { MlxRuntime } from './mlx-process';
import type { KokoroRuntime } from './kokoro-onnx';
import type { EspeakRuntime } from './phonemes';
import type { TranscriptionRuntime } from './transcription-process';

export interface VoiceRuntime {
  /** MLX engines; each model folder is null until provisioned. Development only for now. */
  mlx: (MlxRuntime & { kokoro: string | null; chatterbox: string | null }) | null;
}

/** Local recognition: whisper's programs and a model to run. */
export interface LocalTranscription {
  transcription: TranscriptionRuntime;
  /** whisper.cpp's server, which keeps the model loaded between turns; null when not built. */
  server: string | null;
  /** The server was built with Metal: let it use the GPU. */
  gpu?: boolean;
}

/** Where voice assets live for this copy of Edi. */
export interface VoicePaths {
  appPath: string;
  packaged: boolean;
  /** The app's Resources folder (packaged builds ship whisper's programs there). */
  resourcesPath: string;
  /** Edi's own model folder in Application Support, where downloaded models go. */
  modelsDir: string;
}

/** Recognition models Edi can run, best first. */
const WHISPER_MODELS = ['ggml-small.en.bin', 'ggml-base.en.bin'];

/** The development cache provisioned under `benchmarks/voice` (see its README). */
const devVoice = (appPath: string) => resolve(appPath, '../../benchmarks/voice');

/** Downloaded models; the manager in Settings → Voice writes here. */
export const whisperModelsDir = (paths: VoicePaths) => join(paths.modelsDir, 'whisper');
export const kokoroModelsDir = (paths: VoicePaths) => join(paths.modelsDir, 'kokoro');

/**
 * eSpeak NG, which turns words into the sounds Kokoro speaks. It is GPL-3.0, so it ships as its
 * own program (built by native/espeak/build.sh) and Edi runs it, never links it.
 */
export function resolveEspeak(paths: VoicePaths): EspeakRuntime | null {
  const folder = paths.packaged
    ? join(paths.resourcesPath, 'espeak')
    : resolve(paths.appPath, '../../native/espeak/build');
  const executable = join(folder, 'espeak-ng');
  return existsSync(executable) && existsSync(join(folder, 'espeak-ng-data'))
    ? { executable, dataPath: folder }
    : null;
}

/**
 * Chatterbox speaks only in a voice made from a recording, so Edi ships one of its own (made
 * with Kokoro) as the built-in voice; anything else is a recording the person added.
 */
export function resolveChatterboxVoice(paths: VoicePaths) {
  const file = paths.packaged
    ? join(paths.resourcesPath, 'chatterbox-voice.wav')
    : join(paths.appPath, 'voice/chatterbox-voice.wav');
  return existsSync(file) ? file : null;
}

/** Kokoro and its voices, once the pack is downloaded, with eSpeak to pronounce the words. */
export function resolveKokoro(paths: VoicePaths): KokoroRuntime | null {
  const folder = kokoroModelsDir(paths);
  const model = join(folder, 'model.onnx');
  const espeak = resolveEspeak(paths);
  return espeak && existsSync(model) ? { model, voices: join(folder, 'voices'), espeak } : null;
}

/**
 * Whisper's programs and the best model present, or null while no model is downloaded.
 * Packaged builds run the self-contained programs shipped in Resources (native/whisper);
 * development uses the pinned build in `benchmarks/voice`. Checked on demand, so a model that
 * finishes downloading is used without a restart.
 */
export function resolveLocalTranscription(paths: VoicePaths): LocalTranscription | null {
  let programs: { cli: string; server: string; vad: string };
  let devModels: string | null = null;
  if (paths.packaged) {
    const bundled = join(paths.resourcesPath, 'whisper');
    programs = {
      cli: join(bundled, 'whisper-cli'),
      server: join(bundled, 'whisper-server'),
      vad: join(bundled, 'ggml-silero-v6.2.0.bin'),
    };
  } else {
    devModels = join(devVoice(paths.appPath), 'cache/transcription');
    const build = existsSync(devModels)
      ? readdirSync(devModels).find(name => name.startsWith('whisper.cpp-'))
      : undefined;
    const bin = join(devModels, build ?? 'missing', 'build/bin');
    programs = {
      cli: join(bin, 'whisper-cli'),
      server: join(bin, 'whisper-server'),
      vad: join(devModels, 'ggml-silero-v6.2.0.bin'),
    };
  }
  if (!existsSync(programs.cli) || !existsSync(programs.vad)) return null;
  const folders = [whisperModelsDir(paths), ...(devModels ? [devModels] : [])];
  const model = WHISPER_MODELS.flatMap(name => folders.map(folder => join(folder, name))).find(
    existsSync,
  );
  if (!model) return null;
  const local: LocalTranscription = {
    transcription: { executable: programs.cli, model, vadModel: programs.vad },
    server: existsSync(programs.server) ? programs.server : null,
  };
  // Owner A/B only: EDI_TRANSCRIPTION_MODEL=large-v3-turbo uses the large model on the Metal
  // build. small.en stays the default: on accented synthetic voices it matched turbo once given
  // the person's words, spelled "Edi" reliably, and needs no first-launch GPU compile.
  if (devModels && process.env.EDI_TRANSCRIPTION_MODEL === 'large-v3-turbo') {
    const turbo = join(devModels, 'ggml-large-v3-turbo-q5_0.bin');
    const metal = join(programs.server, '../../../build-metal/bin/whisper-server');
    if (existsSync(turbo) && existsSync(metal)) {
      local.transcription.model = turbo;
      local.server = metal;
      local.gpu = true;
    }
  }
  return local;
}

/**
 * The local speech engines. Listening is found separately (`resolveLocalTranscription`), since
 * it may be downloaded later or come from Cartesia instead. MLX voices (Kokoro, Chatterbox)
 * exist only in development until their packs ship.
 */
export function resolveVoiceRuntime(paths: VoicePaths): VoiceRuntime {
  if (paths.packaged) return { mlx: null };
  const voice = devVoice(paths.appPath);
  const mlx = {
    python: join(voice, 'mlx-venv/bin/python'),
    worker: join(paths.appPath, 'voice/mlx_worker.py'),
    cache: join(voice, 'cache/mlx'),
  };
  // Provisioned by benchmarks/voice/provision_mlx.py. A model counts only if its weights exist.
  const model = (folder: string, weights: string) =>
    existsSync(join(voice, 'cache/mlx', folder, weights)) ? join(voice, 'cache/mlx', folder) : null;
  if (!Object.values(mlx).every(existsSync)) return { mlx: null };
  return {
    mlx: {
      ...mlx,
      kokoro: model('kokoro', 'kokoro-v1_0.safetensors'),
      chatterbox: model('chatterbox-4bit', 'model.safetensors'),
    },
  };
}
