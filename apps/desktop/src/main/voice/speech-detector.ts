import type { InferenceSession, Tensor } from 'onnxruntime-node';
import { SpeechActivity, type SpeechActivityEvent } from '@edi/contracts';

/** Silero reads 32 ms windows at 16 kHz, each with the 4 ms of audio before it. */
const WINDOW = 512;
const CONTEXT = 64;
/** The pet sends 20 ms frames of 16 kHz PCM16. */
const FRAME_SAMPLES = 320;
const FRAME_MS = 20;
/** Audio kept from just before speech starts, so the first word is not clipped. */
const PREROLL_FRAMES = 20;
/** Silero's own advice: a voice starts above 0.5 and lasts until it falls below 0.35. */
const VOICE_START = 0.5;
const VOICE_KEEP = 0.35;

/** How likely each 32 ms window is a voice, 0–1; one stream per conversation (it keeps state). */
export interface VoiceProbability {
  next(window: Float32Array): Promise<number>;
}

/**
 * Silero VAD (v6.2.1, MIT, `voice/silero_vad.onnx`) on ONNX Runtime. A small neural model that
 * tells a voice from other sound: loud typing, a door or music scores low, speech scores high.
 * One loaded session serves every conversation; each gets its own stream state.
 */
export class SileroVad {
  private constructor(
    private readonly session: InferenceSession,
    private readonly tensor: typeof Tensor,
  ) {}

  static async load(modelPath: string) {
    const ort = await import('onnxruntime-node');
    const session = await ort.InferenceSession.create(modelPath, {
      // A 2 MB model run every 32 ms: one thread is plenty and leaves the rest alone.
      intraOpNumThreads: 1,
      interOpNumThreads: 1,
      executionMode: 'sequential',
      graphOptimizationLevel: 'all',
    });
    return new SileroVad(session, ort.Tensor);
  }

  stream(): VoiceProbability {
    const Tensor = this.tensor;
    let state = new Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]);
    const context = new Float32Array(CONTEXT);
    const sampleRate = new Tensor('int64', BigInt64Array.from([16_000n]), []);
    return {
      next: async window => {
        const input = new Float32Array(CONTEXT + WINDOW);
        input.set(context);
        input.set(window, CONTEXT);
        context.set(window.subarray(WINDOW - CONTEXT));
        const result = await this.session.run({
          input: new Tensor('float32', input, [1, CONTEXT + WINDOW]),
          state,
          sr: sampleRate,
        });
        state = result.stateN as typeof state;
        return Number((result.output as Tensor).data[0] ?? 0);
      },
    };
  }
}

/** What an audio chunk amounted to, in order: speech events, and audio for the recognizer. */
export type Heard = { event: SpeechActivityEvent } | { audio: Uint8Array };

/**
 * Hands-free listening in main. The pet streams every frame of an open conversation here; this
 * decides when someone starts and stops talking, from loudness and (with Silero) whether the
 * sound is a voice, and hands the recognizer the speech plus the moment before it.
 */
export class SpeechDetector {
  private readonly activity: SpeechActivity;
  private readonly window = new Float32Array(WINDOW);
  private filled = 0;
  /** Silero hears a voice now, with its start/keep thresholds applied. */
  private voice = false;
  private preroll: Uint8Array[] = [];
  private streaming = false;
  private carry = new Uint8Array(0);
  private queue: Promise<unknown> = Promise.resolve();

  /** Without a voice model (not loaded, or failed), loudness alone decides. */
  constructor(private readonly probability: VoiceProbability | null) {
    this.activity = new SpeechActivity({ voiceDetector: probability !== null });
  }

  /** One chunk of 16 kHz PCM16; `edisSpeaking` while her voice is audible. Chunks run in order. */
  push(pcm: Uint8Array, edisSpeaking: boolean): Promise<Heard[]> {
    const run = this.queue.then(() => this.process(pcm, edisSpeaking));
    this.queue = run.catch(() => {});
    return run;
  }

  /** The utterance was handed to the model: wait for new speech. */
  finishUtterance() {
    this.streaming = false;
    this.preroll = [];
    this.activity.reset();
  }

  private async process(pcm: Uint8Array, edisSpeaking: boolean) {
    const bytes = new Uint8Array(this.carry.byteLength + pcm.byteLength);
    bytes.set(this.carry);
    bytes.set(pcm, this.carry.byteLength);
    const frameBytes = FRAME_SAMPLES * 2;
    const whole = bytes.byteLength - (bytes.byteLength % frameBytes);
    this.carry = bytes.slice(whole);
    const heard: Heard[] = [];
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = 0; offset < whole; offset += frameBytes) {
      let sum = 0;
      for (let i = 0; i < FRAME_SAMPLES; i++) {
        const sample = view.getInt16(offset + i * 2, true) / 32768;
        sum += sample * sample;
        this.window[this.filled++] = sample;
        if (this.filled === WINDOW) {
          this.filled = 0;
          if (this.probability) {
            const chance = await this.probability.next(this.window);
            this.voice = chance >= (this.voice ? VOICE_KEEP : VOICE_START);
          }
        }
      }
      const rms = Math.sqrt(sum / FRAME_SAMPLES);
      const frame = bytes.slice(offset, offset + frameBytes);
      const voice = this.probability ? this.voice : true;
      for (const event of this.activity.frame(rms, FRAME_MS, edisSpeaking, voice)) {
        heard.push({ event });
        if (event === 'speech' && !this.streaming) {
          this.streaming = true;
          for (const audio of this.preroll.splice(0)) heard.push({ audio });
        }
      }
      if (this.streaming) heard.push({ audio: frame });
      else {
        this.preroll.push(frame);
        if (this.preroll.length > PREROLL_FRAMES) this.preroll.shift();
      }
    }
    return heard;
  }
}
