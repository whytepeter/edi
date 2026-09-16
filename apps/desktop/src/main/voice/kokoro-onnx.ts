import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { InferenceSession, Tensor } from 'onnxruntime-node';
import { MAX_PHONEMES, phonemeTokens, phonemize, type EspeakRuntime } from './phonemes';

/** Kokoro speaks at this rate; the player resamples. */
export const KOKORO_RATE = 24_000;
/** Each voice is a table of 510 style vectors, one per possible length, of 256 numbers each. */
const STYLE_SIZE = 256;

export interface KokoroRuntime {
  /** `model_quantized.onnx` in Edi's models folder. */
  model: string;
  /** The folder of `<voice>.bin` style files. */
  voices: string;
  espeak: EspeakRuntime;
}

type Consume = (pcm: Float32Array, rate: number) => Promise<void>;

/**
 * Kokoro 82M on ONNX Runtime, speaking on this Mac with no Python: eSpeak NG (a separate
 * program) turns the words into sounds, this turns those into audio. The model is loaded on
 * first use and unloaded after an idle spell. Long replies are spoken in pieces, split at
 * sentence ends, because the model reads at most 510 symbols at a time.
 */
export class KokoroOnnx {
  private session?: Promise<InferenceSession>;
  private tensor?: typeof Tensor;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private ready = false;
  private readonly styles = new Map<string, Float32Array>();
  readonly label = 'Kokoro';
  /** Time from handing over the words to the first playable audio, as Settings reports it. */
  lastFirstAudioMs: number | null = null;

  constructor(
    private readonly runtime: KokoroRuntime,
    private readonly options: { idleMs?: number } = {},
  ) {}

  /** Start loading now, so the first reply does not wait for it. */
  warm() {
    void this.load().catch(() => {});
  }

  get status(): 'off' | 'loading' | 'ready' {
    if (!this.session) return 'off';
    return this.ready ? 'ready' : 'loading';
  }

  private async load() {
    const ort = await import('onnxruntime-node');
    this.tensor = ort.Tensor;
    this.session ??= ort.InferenceSession.create(this.runtime.model, {
      intraOpNumThreads: 4,
      graphOptimizationLevel: 'all',
    }).then(session => {
      this.ready = true;
      return session;
    });
    return this.session;
  }

  /** The style vector for this voice at this length; each voice file is read once. */
  private async style(voice: string, length: number) {
    if (!/^[a-z]{2}_[a-z]+$/.test(voice)) throw new Error('Unknown voice');
    let table = this.styles.get(voice);
    if (!table) {
      const file = await readFile(join(this.runtime.voices, `${voice}.bin`));
      table = new Float32Array(file.buffer, file.byteOffset, file.byteLength / 4);
      this.styles.set(voice, table);
    }
    const row = Math.min(Math.max(length, 0), table.length / STYLE_SIZE - 1);
    return table.slice(row * STYLE_SIZE, (row + 1) * STYLE_SIZE);
  }

  /**
   * Speak `text` in `voice`, handing each piece of audio to `consume` as it is ready. `speed`
   * is a multiplier around 1. Cancels at the next piece when the signal aborts.
   */
  async speak(
    text: string,
    signal: AbortSignal,
    consume: Consume,
    options: { voice: string; speed?: number },
  ) {
    const started = Date.now();
    let first = true;
    const phonemes = await phonemize(this.runtime.espeak, text, signal);
    if (!phonemes.trim()) return;
    const session = await this.load();
    const Tensor = this.tensor!;
    for (const piece of readablePieces(phonemes)) {
      signal.throwIfAborted();
      const tokens = phonemeTokens(piece);
      if (tokens.length <= 2) continue;
      const style = await this.style(options.voice, tokens.length - 2);
      const result = await session.run({
        input_ids: new Tensor('int64', BigInt64Array.from(tokens.map(BigInt)), [1, tokens.length]),
        style: new Tensor('float32', style, [1, STYLE_SIZE]),
        speed: new Tensor('float32', Float32Array.from([options.speed ?? 1]), [1]),
      });
      signal.throwIfAborted();
      const audio = (result.waveform ?? Object.values(result)[0]) as Tensor;
      if (first) {
        this.lastFirstAudioMs = Date.now() - started;
        first = false;
      }
      await consume(new Float32Array(audio.data as Float32Array), KOKORO_RATE);
      this.scheduleIdle();
    }
  }

  /** Free the model after an idle spell; the next reply loads it again. */
  private scheduleIdle() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => void this.dispose(), this.options.idleMs ?? 60 * 60_000);
    this.idleTimer.unref?.();
  }

  async dispose() {
    clearTimeout(this.idleTimer);
    const session = this.session;
    this.session = undefined;
    this.ready = false;
    this.styles.clear();
    await session?.then(loaded => loaded.release()).catch(() => {});
  }
}

/**
 * Phonemes in the pieces Kokoro speaks, one sentence at a time: the first words are heard while
 * the rest is still being made, instead of waiting for a whole paragraph. A sentence longer than
 * the model can read is split again where a speaker would pause.
 */
export function readablePieces(phonemes: string, limit = MAX_PHONEMES) {
  const pieces: string[] = [];
  for (const sentence of phonemes.split(/(?<=[.!?…])\s+/)) {
    let rest = sentence.trim();
    while (rest.length > limit) {
      const window = rest.slice(0, limit);
      const mark = Math.max(...[',', ';', ':', '—'].map(pause => window.lastIndexOf(pause)));
      const space = window.lastIndexOf(' ');
      // A comma is a better place to breathe than any old gap between words.
      const cut = mark > limit / 4 ? mark + 1 : space > limit / 4 ? space + 1 : limit;
      pieces.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) pieces.push(rest);
  }
  return pieces;
}
