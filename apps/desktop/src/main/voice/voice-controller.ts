import {
  initialVoiceSession,
  transitionVoice,
  type AgentState,
  type VoiceEffect,
  type VoiceEvent,
  type VoiceHostEvent,
  type VoiceMode,
  type VoiceSession,
} from '@edi/contracts';
import type { VoiceRuntime } from './runtime';
import type { TranscriptionRuntime } from './transcription-process';

export type VoiceStatus = 'listening' | 'thinking' | 'speaking' | 'hidden' | { notice: string };

/** Everything the driver touches is injected, so it runs (and is tested) without Electron. */
export interface VoiceDependencies<Screens> {
  runtime: VoiceRuntime | null;
  /** To the pet renderer, which owns the microphone and speaker. */
  send(event: VoiceHostEvent): void;
  status(status: VoiceStatus): void;
  /** macOS microphone permission; asks the first time, false if refused. */
  microphoneAccess(): Promise<boolean>;
  captureScreens(prompt: string): Promise<Screens>;
  ask(prompt: string, options: { screens: Screens; spoken: true }): Promise<string | undefined>;
  whenFinished(runId: string, signal: AbortSignal): Promise<AgentState>;
  stopAgent(): void;
  transcribe(runtime: TranscriptionRuntime, pcm: Uint8Array, signal: AbortSignal): Promise<string>;
  speak(
    text: string,
    signal: AbortSignal,
    consume: (pcm: Float32Array, sampleRate: number) => Promise<void>,
  ): Promise<void>;
  /** Begin loading the speech model; called the moment a hold starts. */
  warmSpeech(): void;
}

/** The player must accept each chunk within this time, backpressure included. */
const PLAYBACK_ACK_MS = 5000;
const MAX_SPOKEN_CHARS = 600;

/** Whisper marks non-speech as tags like [BLANK_AUDIO] or (music); they are not a question. */
export function cleanTranscript(text: string) {
  return text
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Plain words for speech: no Markdown, no pointing tags, a sentence boundary under the cap. */
export function speakable(text: string) {
  const plain = text
    .replace(/\[POINT:[^\]]*\]/gi, ' ')
    .replace(/[*_`#>|~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= MAX_SPOKEN_CHARS) return plain;
  const cut = plain.slice(0, MAX_SPOKEN_CHARS);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  return end > 80 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
}

/**
 * Drives one voice session through the pure policy in @edi/contracts:
 * hold → microphone opens → release → transcript → optional screen context → agent →
 * spoken reply. Every step is bound to the session generation; Stop or a new
 * hold invalidates everything in flight.
 */
export class VoiceController<Screens> {
  private session: VoiceSession = initialVoiceSession;
  private turn?: AbortController;
  private pendingAck?: () => void;
  private notice?: string;
  private quietError = false;

  constructor(private readonly deps: VoiceDependencies<Screens>) {}

  get available() {
    return this.deps.runtime !== null;
  }

  get phase() {
    return this.session.phase;
  }

  /** The permission handler grants the microphone only while a turn is opening or listening. */
  get wantsMicrophone() {
    return this.session.phase === 'opening' || this.session.phase === 'listening';
  }

  start(mode: VoiceMode) {
    if (!this.available) return false;
    this.deps.warmSpeech();
    this.dispatch({ type: 'start', mode });
    return true;
  }

  release() {
    this.dispatch({ type: 'release', generation: this.session.generation });
  }

  stop() {
    if (this.session.phase !== 'idle' || this.turn) this.dispatch({ type: 'stop' });
  }

  clientEvent(generation: number, event: 'capture-ready' | 'speech-detected' | 'failed') {
    if (event === 'failed' && generation === this.session.generation) {
      this.notice = 'I couldn’t use the microphone.';
    }
    this.dispatch({ type: event, generation });
  }

  played(generation: number) {
    if (generation !== this.session.generation) return;
    const ack = this.pendingAck;
    this.pendingAck = undefined;
    ack?.();
  }

  /** The recorded turn, decoded to 16 kHz PCM16 by the pet renderer. */
  async audio(generation: number, pcm: Uint8Array) {
    if (generation !== this.session.generation || this.session.phase !== 'processing') return;
    const runtime = this.deps.runtime!;
    const turn = new AbortController();
    this.turn = turn;
    const ended = (notice?: string) => {
      this.notice = notice;
      this.dispatch({ type: 'reply-ended', generation });
    };
    try {
      const heard = cleanTranscript(
        await this.deps.transcribe(runtime.transcription, pcm, turn.signal),
      );
      if (turn.signal.aborted) return;
      if (!heard) return ended('I didn’t catch that.');

      const screens = await this.deps.captureScreens(heard);
      if (turn.signal.aborted) return;
      const runId = await this.deps.ask(heard, { screens, spoken: true });
      if (turn.signal.aborted) return;
      if (!runId) return ended('Open Edi to continue.');
      const reply = await this.deps.whenFinished(runId, turn.signal);
      if (turn.signal.aborted) return;

      const speech = speakable(reply.text);
      if (reply.status !== 'done' || !speech) {
        return ended(reply.status === 'error' ? 'Something went wrong. Try again.' : undefined);
      }
      this.dispatch({ type: 'reply-started', generation });
      await this.deps.speak(speech, turn.signal, (samples, rate) =>
        this.play(generation, samples, rate, turn.signal),
      );
      if (!turn.signal.aborted) ended();
    } catch (error) {
      if (turn.signal.aborted) return;
      this.notice =
        error instanceof Error && error.message === 'Set up OpenRouter first.'
          ? error.message
          : 'Voice stopped. Try again.';
      this.dispatch({ type: 'failed', generation });
    } finally {
      if (this.turn === turn) this.turn = undefined;
    }
  }

  /** Resolves once the player accepts the chunk: the speech process waits on this. */
  private play(generation: number, samples: Float32Array, rate: number, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Playback stalled')), PLAYBACK_ACK_MS);
      const settle = () => clearTimeout(timer);
      this.pendingAck = () => {
        settle();
        resolve();
      };
      signal.addEventListener(
        'abort',
        () => {
          settle();
          reject(new Error('Stopped'));
        },
        { once: true },
      );
      this.deps.send({ type: 'pcm', generation, rate, samples });
    });
  }

  private dispatch(event: VoiceEvent) {
    const previous = this.session;
    const { state, effects } = transitionVoice(previous, event);
    this.session = state;
    for (const effect of effects) this.apply(effect, previous);
    if (state.phase !== previous.phase || this.notice) this.render();
  }

  private apply(effect: VoiceEffect, previous: VoiceSession) {
    const generation = this.session.generation;
    if (effect === 'cancel-all') {
      this.turn?.abort();
      this.turn = undefined;
      this.pendingAck = undefined;
      this.deps.send({ type: 'cancel', generation: previous.generation });
      this.deps.send({ type: 'stop-audio' });
      this.deps.stopAgent();
    } else if (effect === 'open-microphone') {
      void this.deps.microphoneAccess().then(granted => {
        if (generation !== this.session.generation) return;
        if (!granted) {
          // The just-in-time permission card is already visible. Avoid a second,
          // oversized bubble repeating the same instruction.
          this.quietError = true;
          this.dispatch({ type: 'failed', generation });
          return;
        }
        this.deps.send({ type: 'open', generation });
      });
    } else if (effect === 'close-microphone') {
      this.deps.send({ type: 'finish', generation });
    }
    // 'submit-turn': the recording arrives through audio().
  }

  private render() {
    const notice = this.notice;
    this.notice = undefined;
    const phase = this.session.phase;
    if (notice && (phase === 'idle' || phase === 'error')) this.deps.status({ notice });
    else if (phase === 'listening') this.deps.status('listening');
    else if (phase === 'processing') this.deps.status('thinking');
    else if (phase === 'speaking') this.deps.status('speaking');
    else if (phase === 'error' && this.quietError) {
      this.quietError = false;
      this.deps.status('hidden');
    } else if (phase === 'error') this.deps.status({ notice: 'Voice stopped. Try again.' });
    else this.deps.status('hidden');
  }
}
