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

export type VoiceStatus =
  'opening' | 'listening' | 'thinking' | 'speaking' | 'hidden' | { notice: string };

/** Everything the driver touches is injected, so it runs (and is tested) without Electron. */
export interface VoiceDependencies<Screens> {
  runtime: VoiceRuntime | null;
  /** To the pet renderer, which owns the microphone and speaker. */
  send(event: VoiceHostEvent): void;
  status(status: VoiceStatus): void;
  /** macOS microphone permission; asks the first time, false if refused. */
  microphoneAccess(): Promise<boolean>;
  captureScreens(prompt: string): Promise<Screens>;
  ask(
    prompt: string,
    options: { screens: Screens; spoken: true; expressiveVoice: boolean },
  ): Promise<string | undefined>;
  whenFinished(
    runId: string,
    signal: AbortSignal,
    onUpdate?: (state: AgentState) => void,
  ): Promise<AgentState>;
  stopAgent(): void;
  transcribe(runtime: TranscriptionRuntime, pcm: Uint8Array, signal: AbortSignal): Promise<string>;
  speak(
    text: string,
    signal: AbortSignal,
    consume: (pcm: Float32Array, sampleRate: number) => Promise<void>,
  ): Promise<void>;
  /** Begin loading the speech model; called the moment a hold starts. */
  warmSpeech(): void;
  /** Settings → Voice. False answers in the conversation only. Defaults to speaking. */
  speakReplies?(): boolean;
  /** Whether the selected speech engine understands paralinguistic tags. */
  expressiveVoice?(): boolean;
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
export function speakable(text: string, expressions = false) {
  let plain = text
    // Source links are read as their words; addresses themselves are never spoken.
    .replace(/\[([^\]]+)\]\((?:https?:\/\/|www\.)[^)\s]*\)/gi, '$1')
    .replace(/\b(?:https?:\/\/|www\.)[^\s)]*[^\s).,;:!?]/gi, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/\[(?:POINT|DRAW):[^\]]*\]/gi, ' ')
    .replace(/[*_`#>|~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!expressions)
    plain = plain
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  if (plain.length <= MAX_SPOKEN_CHARS) return plain;
  const cut = plain.slice(0, MAX_SPOKEN_CHARS);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  return end > 80 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
}

/** Next spoken clip, plus the prefix already handed to the speech engine. */
export function takeSpeech(
  full: string,
  spoken: string,
  expressions = false,
  final = false,
): { say: string; spoken: string } {
  const plain = speakable(full, expressions);
  const aligned = plain.startsWith(spoken) ? spoken : '';
  const rest = plain.slice(aligned.length).replace(/^\s+/, '');
  if (!rest) return { say: '', spoken: aligned };
  // Once something is playing, everything left goes in one clip: each clip has a fixed synthesis
  // cost, so fewer, longer clips finish sooner. The very first clip stays short either way.
  if (final && aligned) return { say: rest, spoken: plain };

  const pieces: string[] = [];
  let remaining = rest;
  for (;;) {
    const match = remaining.match(/^([\s\S]*?[.!?])(?:\s+|$)/);
    if (!match) break;
    pieces.push(match[1] ?? '');
    remaining = remaining.slice(match[0].length);
  }
  const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
  let say = pieces.join(' ');
  if (!aligned && pieces.length) {
    // First clip: the fewest complete sentences that make at least four words. Chatterbox takes
    // about three seconds for up to ~8 words on an M2 Pro and ~6 s for 15, so a long first
    // sentence starts at its first clause break.
    let count = 1;
    while (count < pieces.length && words(pieces.slice(0, count).join(' ')) < 4) count++;
    say = pieces.slice(0, count).join(' ');
    const clause = words(say) > 10 ? say.match(/^((?:\S+\s+){4,}?\S*[,;:—–])\s/) : null;
    if (clause) say = clause[1] ?? say;
  }
  if (final && !say) say = rest;
  if (!say && !aligned) {
    // Chatterbox cannot emit audio until a clip is synthesized, so the first clip should not
    // wait for a long sentence to finish. It still ends where a speaker would pause (a comma,
    // semicolon, colon or dash); cutting after a fixed word count paused mid-phrase.
    const clause = rest.match(/^((?:\S+\s+){4,}?\S*[,;:—–])\s/);
    if (clause) say = clause[1] ?? '';
  }
  if (!say) return { say: '', spoken: aligned };
  return { say, spoken: aligned ? `${aligned} ${say}` : say };
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

  /**
   * Play a short voice sample (Settings → Voice) through the same speaker path as replies. Only
   * while voice is idle; Stop or a new hold cancels it like any reply.
   */
  async preview(
    speak: (
      signal: AbortSignal,
      consume: (pcm: Float32Array, sampleRate: number) => Promise<void>,
    ) => Promise<void>,
  ) {
    if (!this.available || this.session.phase !== 'idle' || this.turn) return false;
    const turn = new AbortController();
    this.turn = turn;
    const generation = this.session.generation;
    // A fresh playback token, so the sample never queues behind the end of an older reply.
    this.deps.send({ type: 'stop-audio' });
    try {
      await speak(turn.signal, (samples, rate) =>
        this.play(generation, samples, rate, turn.signal),
      );
      return true;
    } finally {
      if (this.turn === turn) this.turn = undefined;
    }
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
      const expressiveVoice = this.deps.expressiveVoice?.() ?? false;
      const runId = await this.deps.ask(heard, { screens, spoken: true, expressiveVoice });
      if (turn.signal.aborted) return;
      if (!runId) return ended('Open Edi to continue.');

      let spoken = '';
      let started = false;
      let audible = false;
      let speechQueue = Promise.resolve();
      const enqueue = (text: string) => {
        if (!text || this.deps.speakReplies?.() === false) return;
        started = true;
        speechQueue = speechQueue.then(() => {
          if (turn.signal.aborted) return;
          return this.deps.speak(text, turn.signal, (samples, rate) => {
            // Edi looks like it is speaking only once there is sound. Synthesis can take seconds,
            // and until the first samples arrive the bubble keeps showing that it is thinking.
            if (!audible) {
              audible = true;
              this.dispatch({ type: 'reply-started', generation });
            }
            return this.play(generation, samples, rate, turn.signal);
          });
        });
      };
      const pull = (text: string, final: boolean) => {
        const next = takeSpeech(text, spoken, expressiveVoice, final);
        spoken = next.spoken;
        enqueue(next.say);
      };

      const reply = await this.deps.whenFinished(runId, turn.signal, state => {
        if (state.status === 'error' || state.status === 'stopped') return;
        pull(state.text, false);
      });
      if (turn.signal.aborted) return;
      if (reply.status !== 'done') {
        return ended(
          reply.status === 'error'
            ? 'I couldn’t reach the AI model. I left the details in Conversations.'
            : undefined,
        );
      }
      if (this.deps.speakReplies?.() === false) return ended('Answered in Conversations.');
      // A reply that arrived all at once still starts with a short first clip.
      if (!spoken) pull(reply.text, false);
      pull(reply.text, true);
      if (!started) return ended();
      await speechQueue;
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
    else if (phase === 'opening') this.deps.status('opening');
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
