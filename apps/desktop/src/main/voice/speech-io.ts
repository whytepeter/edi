/** Streaming speech in and out, independent of which engine does the work. */

export type Consume = (pcm: Float32Array, sampleRate: number) => Promise<void>;

/**
 * Recognizes one utterance while it is spoken. Audio is pushed as it arrives; `transcript()`
 * may be called at every pause and returns all the words so far.
 */
export interface Transcriber {
  push(pcm: Uint8Array): void;
  transcript(): Promise<string>;
  close(): void;
}

/**
 * One reply spoken as a single stream: text is added as the model writes it and audio starts
 * with the first words, so the voice keeps one natural delivery across sentences.
 */
export interface SpeechStream {
  say(text: string): void;
  /** The stream broke (connection, key, provider error); nothing more will play from it. */
  readonly failed: boolean;
  /** No more text: resolves once every word has been handed to the player. */
  end(): Promise<void>;
}

/** 16 kHz PCM16 kept for an utterance: 60 seconds, like a push-to-talk recording. */
export const MAX_UTTERANCE_BYTES = 16_000 * 2 * 60;

/** Joins PCM16 chunks, dropping audio past the utterance limit. */
export class PcmBuffer {
  private chunks: Uint8Array[] = [];
  bytes = 0;

  push(pcm: Uint8Array) {
    const room = MAX_UTTERANCE_BYTES - this.bytes;
    if (room <= 0) return;
    const part = pcm.byteLength > room ? pcm.subarray(0, room - (room % 2)) : pcm;
    this.chunks.push(part.slice());
    this.bytes += part.byteLength;
  }

  join() {
    const joined = new Uint8Array(this.bytes);
    let offset = 0;
    for (const chunk of this.chunks) {
      joined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return joined;
  }

  clear() {
    for (const chunk of this.chunks) chunk.fill(0);
    this.chunks = [];
    this.bytes = 0;
  }
}

/**
 * Bytes of little-endian PCM16 arrive in arbitrary sizes; complete samples come out as float
 * frames of at most one second, the most the player accepts per chunk.
 */
export class Pcm16Frames {
  private pending = new Uint8Array(0);

  constructor(private readonly rate: number) {}

  push(value: Uint8Array): Float32Array[] {
    const joined = new Uint8Array(this.pending.length + value.length);
    joined.set(this.pending);
    joined.set(value, this.pending.length);
    const whole = joined.length - (joined.length % 2);
    this.pending = joined.slice(whole);
    const view = new DataView(joined.buffer, joined.byteOffset, whole);
    const frames: Float32Array[] = [];
    for (let start = 0; start < whole / 2; start += this.rate) {
      const count = Math.min(this.rate, whole / 2 - start);
      const frame = new Float32Array(count);
      for (let i = 0; i < count; i++) frame[i] = view.getInt16((start + i) * 2, true) / 32768;
      frames.push(frame);
    }
    return frames;
  }
}
