/**
 * Cartesia over WebSockets, with the person's own key (checked 2026-09-15):
 * - Speech: wss://api.cartesia.ai/tts/websocket. One context per reply; each sentence is sent
 *   with `continue: true` as the model writes it, so audio starts with the first words and the
 *   voice keeps one delivery across sentences. `cancel` stops a context.
 * - Recognition: wss://api.cartesia.ai/stt/websocket. PCM16 at 16 kHz as binary frames;
 *   `finalize` returns the words so far (final transcripts, then `flush_done`).
 * Only the reply's words, or the microphone audio of an utterance, go to Cartesia.
 */
import { randomUUID } from 'node:crypto';
import { CARTESIA_MODEL, CARTESIA_VERSION, cloudError } from './cloud-voice';
import {
  Pcm16Frames,
  PcmBuffer,
  type Consume,
  type SpeechStream,
  type Transcriber,
} from './speech-io';

export const CARTESIA_STT_MODEL = 'ink-2';
const RATE = 24_000;
const FIRST_AUDIO_MS = 15_000;
const FINALIZE_MS = 5_000;

/** The subset of WebSocket used here; tests pass a fake. */
export interface SocketLike {
  readyState: number;
  binaryType: string;
  send(data: string | ArrayBufferView | ArrayBuffer): void;
  close(): void;
  addEventListener(type: 'open' | 'close' | 'error', listener: () => void): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}
export type SocketFactory = (url: string, headers: Record<string, string>) => SocketLike;

export interface CartesiaRealtimeDependencies {
  socket?: SocketFactory;
  baseUrl?: string;
}

const OPEN = 1;
const defaultSocket: SocketFactory = (url, headers) =>
  // Node's WebSocket (undici) accepts headers; the key never goes in the address.
  new (
    WebSocket as unknown as new (
      url: string,
      init: { headers: Record<string, string> },
    ) => SocketLike
  )(url, { headers });

/** Sends wait until the socket opens; a socket that closes early fails everything waiting. */
function connect(url: string, key: string, deps: CartesiaRealtimeDependencies) {
  const socket = (deps.socket ?? defaultSocket)(url, {
    'X-API-Key': key,
    'Cartesia-Version': CARTESIA_VERSION,
  });
  socket.binaryType = 'arraybuffer';
  const waiting: (string | Uint8Array)[] = [];
  socket.addEventListener('open', () => {
    for (const data of waiting.splice(0)) socket.send(data);
  });
  return {
    socket,
    send(data: string | Uint8Array) {
      if (socket.readyState === OPEN) socket.send(data);
      else if (socket.readyState === 0) waiting.push(data);
    },
  };
}

function parse(data: unknown): Record<string, unknown> | null {
  if (typeof data !== 'string') return null;
  try {
    const value: unknown = JSON.parse(data);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const statusOf = (message: Record<string, unknown>) =>
  typeof message.status_code === 'number' ? message.status_code : 500;

/**
 * Speak one reply as a stream. Audio frames go to the player one at a time (backpressure);
 * `end()` resolves once the last one was accepted. Aborting cancels the context at Cartesia.
 */
export function streamCartesiaSpeech(
  key: string,
  voice: string,
  signal: AbortSignal,
  consume: Consume,
  deps: CartesiaRealtimeDependencies = {},
): SpeechStream & { readonly characters: number } {
  const base = (deps.baseUrl ?? 'wss://api.cartesia.ai').replace(/^http/, 'ws');
  const { socket, send } = connect(
    `${base}/tts/websocket?cartesia_version=${CARTESIA_VERSION}`,
    key,
    deps,
  );
  const contextId = randomUUID();
  const frames = new Pcm16Frames(RATE);
  let characters = 0;
  let heard = false;
  let finished = false;
  let failure: Error | undefined;
  let pump = Promise.resolve();
  let resolveDone!: () => void;
  let rejectDone!: (error: Error) => void;
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  void done.catch(() => {});

  // Counted from the first sentence: the socket opens early, while the model may still be working.
  let firstAudio: ReturnType<typeof setTimeout> | undefined;
  const fail = (error: Error) => {
    if (finished) return;
    finished = true;
    failure = error;
    clearTimeout(firstAudio);
    rejectDone(error);
    socket.close();
  };
  const request = (transcript: string, more: boolean) =>
    JSON.stringify({
      model_id: CARTESIA_MODEL,
      transcript,
      voice: { mode: 'id', id: voice },
      output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: RATE },
      language: 'en',
      context_id: contextId,
      continue: more,
      // Sentences arrive whole already; waiting for more text would only delay the voice.
      max_buffer_delay_ms: 0,
    });

  signal.addEventListener(
    'abort',
    () => {
      if (!finished) send(JSON.stringify({ context_id: contextId, cancel: true }));
      fail(new Error('Stopped'));
    },
    { once: true },
  );
  socket.addEventListener('error', () => fail(new Error('Cartesia could not be reached.')));
  socket.addEventListener('close', () => fail(new Error('Cartesia closed the connection.')));
  socket.addEventListener('message', event => {
    const message = parse(event.data);
    if (!message || finished || (message.context_id && message.context_id !== contextId)) return;
    if (message.type === 'error') return fail(cloudError('cartesia', statusOf(message)));
    if (message.type === 'chunk' && typeof message.data === 'string') {
      const pcm = Buffer.from(message.data, 'base64');
      for (const frame of frames.push(pcm)) {
        pump = pump.then(async () => {
          if (finished && failure) return;
          if (!heard) {
            heard = true;
            clearTimeout(firstAudio);
          }
          await consume(frame, RATE);
        });
        pump.catch((error: unknown) =>
          fail(error instanceof Error ? error : new Error('Playback failed')),
        );
      }
    }
    if (message.type === 'done' || message.done === true) {
      clearTimeout(firstAudio);
      void pump.then(
        () => {
          if (finished) return;
          finished = true;
          resolveDone();
          socket.close();
        },
        () => {},
      );
    }
  });

  return {
    get characters() {
      return characters;
    },
    get failed() {
      return Boolean(failure) && failure?.message !== 'Stopped';
    },
    say(text) {
      const words = text.trim();
      if (!words || finished) return;
      firstAudio ??= setTimeout(
        () => fail(new Error('Cartesia returned no audio.')),
        FIRST_AUDIO_MS,
      );
      characters += words.length;
      // A trailing space tells Cartesia this is a word boundary between chunks.
      send(request(`${words} `, true));
    },
    end() {
      if (!finished) {
        if (!characters) {
          finished = true;
          clearTimeout(firstAudio);
          resolveDone();
          socket.close();
        } else send(request('', false));
      }
      return done;
    },
  };
}

/**
 * Recognize an utterance with Cartesia while it is spoken. The audio is also kept here, so a
 * failed connection, a rejected key or a model error falls back to `fallback` (local whisper)
 * for the same words.
 */
export function cartesiaTranscriber(
  key: string,
  fallback: (pcm: Uint8Array, signal: AbortSignal) => Promise<string>,
  deps: CartesiaRealtimeDependencies = {},
): Transcriber {
  const base = (deps.baseUrl ?? 'wss://api.cartesia.ai').replace(/^http/, 'ws');
  const params = new URLSearchParams({
    model: CARTESIA_STT_MODEL,
    encoding: 'pcm_s16le',
    sample_rate: '16000',
    cartesia_version: CARTESIA_VERSION,
  });
  const { socket, send } = connect(`${base}/stt/websocket?${params}`, key, deps);
  const buffer = new PcmBuffer();
  const abort = new AbortController();
  let words = '';
  let failed = false;
  let sentSinceFinalize = false;
  let waiter: { resolve(): void; reject(error: Error): void } | undefined;
  let queue: Promise<unknown> = Promise.resolve();

  const fail = () => {
    failed = true;
    waiter?.reject(new Error('Cartesia transcription failed'));
    waiter = undefined;
  };
  socket.addEventListener('error', fail);
  socket.addEventListener('close', () => {
    if (!abort.signal.aborted) fail();
  });
  socket.addEventListener('message', event => {
    const message = parse(event.data);
    if (!message) return;
    if (message.type === 'error') return fail();
    if (
      message.type === 'transcript' &&
      message.is_final === true &&
      typeof message.text === 'string'
    )
      words += message.text;
    if (message.type === 'flush_done') {
      waiter?.resolve();
      waiter = undefined;
    }
  });

  const local = async () => {
    if (buffer.bytes < 16_000 * 2 * 0.2) return '';
    return fallback(buffer.join(), abort.signal);
  };

  return {
    push(pcm) {
      buffer.push(pcm);
      if (failed) return;
      sentSinceFinalize = true;
      send(pcm.slice());
    },
    transcript() {
      const run = queue.then(async () => {
        if (failed) return local();
        if (!sentSinceFinalize) return words.replace(/\s+/g, ' ').trim();
        sentSinceFinalize = false;
        try {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
              waiter = undefined;
              reject(new Error('Cartesia transcription timed out'));
            }, FINALIZE_MS);
            waiter = {
              resolve: () => (clearTimeout(timer), resolve()),
              reject: error => (clearTimeout(timer), reject(error)),
            };
            send('finalize');
          });
          return words.replace(/\s+/g, ' ').trim();
        } catch {
          failed = true;
          return local();
        }
      });
      queue = run.catch(() => {});
      return run;
    },
    close() {
      abort.abort();
      buffer.clear();
      if (socket.readyState === OPEN) send('close');
      socket.close();
    },
  };
}
