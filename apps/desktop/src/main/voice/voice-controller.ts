import {
  cueSegments,
  initialVoiceSession,
  soundsUnfinished,
  transitionVoice,
  turnTiming,
  type AgentState,
  type VoiceEffect,
  type VoiceEvent,
  type VoiceHostEvent,
  type VoiceMode,
  type VoiceSession,
} from '@edi/contracts';
import type { VoiceRuntime } from './runtime';
import type { Consume, SpeechStream, Transcriber } from './speech-io';
import {
  progressTiming,
  SpokenProgress,
  type ProgressTiming,
  type SpeechQuiet,
} from './spoken-progress';

export type VoiceStatus =
  'opening' | 'listening' | 'thinking' | 'speaking' | 'hidden' | { notice: string };

export type VoiceClientEvent =
  'capture-ready' | 'speech-detected' | 'pause' | 'long-pause' | 'captured' | 'failed';

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
  /** A recognizer for one utterance: whisper on this Mac, or Cartesia when chosen in Settings. */
  listen(): Transcriber;
  speak(text: string, signal: AbortSignal, consume: Consume): Promise<void>;
  /** The whole reply as one stream, when the selected voice supports it (Cartesia); else null. */
  speechStream?(signal: AbortSignal, consume: Consume): SpeechStream | null;
  /** Begin loading the speech and recognition models; called the moment a hold starts. */
  warmSpeech(): void;
  /** Settings → Voice. False answers in the conversation only. Defaults to speaking. */
  speakReplies?(): boolean;
  /** Whether the selected speech engine understands paralinguistic tags. */
  expressiveVoice?(): boolean;
  /** Tests shorten these. */
  timing?: Partial<ProgressTiming & { idleMs: number; tickMs: number }>;
  now?(): number;
}

type Speak = (text: string, signal: AbortSignal, consume: Consume) => Promise<void>;

/** The player must accept each chunk within this time, backpressure included. */
const PLAYBACK_ACK_MS = 5000;
const MAX_SPOKEN_CHARS = 600;

/** The bubble after a voice question fails: the real reason, short, with where to look. */
export function spokenFailure(error: string) {
  const reason = error.trim() || 'Something went wrong with that answer.';
  return reason.length > 110 ? `${reason.slice(0, 107).trimEnd()}…` : reason;
}

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
    .replace(/\[(?:POINT|DRAW|MOOD):[^\]]*\]/gi, ' ')
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

/** How one reply is voiced: a stream when the engine has one, else clip by clip. */
interface ReplyVoice {
  say(text: string): void;
  /** Resolves once everything said has been handed to the player. */
  end(): Promise<void>;
  /**
   * Resolves once the accepted audio has had time to play. The player queues well ahead of the
   * playhead, so a reply is still being heard (and can be talked over) after `end()`.
   */
  drain(paused: () => boolean): Promise<void>;
  quiet(now: number): SpeechQuiet;
}

interface Reply {
  turn: number;
  abort: AbortController;
  /** The person is talking over it: audio holds, playback deadlines wait, no progress lines. */
  paused: boolean;
}

/**
 * Drives voice sessions through the pure policy in @edi/contracts, and is the interruption
 * controller: every piece of work belongs to a session generation and a turn, and Stop, a new
 * hold or words spoken over a reply cancel exactly the work that became stale.
 *
 * Push-to-talk: hold → microphone streams → release → transcript → screens → agent → speech.
 * Conversation (a quick tap): the microphone stays open, pauses are checked against the words so
 * far to find the end of a turn, and speaking over Edi pauses her at once; if words follow,
 * her reply and the work behind it stop and the new request starts.
 */
export class VoiceController<Screens> {
  private session: VoiceSession = initialVoiceSession;
  private reply?: Reply;
  private utterance?: { transcriber: Transcriber; epoch: number };
  /** The words that ended the last hands-free utterance, for `submit-turn`. */
  private heard = '';
  private pendingAck?: { turn: number; resolve(): void };
  private previewing?: AbortController;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private notice?: string;
  private quietError = false;

  constructor(private readonly deps: VoiceDependencies<Screens>) {}

  get available() {
    return this.deps.runtime !== null;
  }

  get phase() {
    return this.session.phase;
  }

  get mode() {
    return this.session.mode;
  }

  /**
   * The permission handler grants the microphone while a turn is opening or listening, and for
   * the whole of a hands-free conversation (the microphone stays open while Edi answers).
   */
  get wantsMicrophone() {
    const { phase, mode } = this.session;
    if (mode === 'conversation') return phase !== 'idle' && phase !== 'error';
    return phase === 'opening' || phase === 'listening';
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

  /** A quick tap of the shortcut: keep listening hands-free instead of ending the hold. */
  converse() {
    const before = this.session.mode;
    this.dispatch({ type: 'converse', generation: this.session.generation });
    if (before === this.session.mode) return false;
    // Push-to-talk streamed everything from the start; hands-free waits for speech instead.
    this.endUtterance(false);
    this.deps.send({ type: 'converse', generation: this.session.generation });
    this.armIdle();
    return true;
  }

  stop() {
    if (this.session.phase !== 'idle' || this.reply || this.previewing)
      this.dispatch({ type: 'stop' });
  }

  clientEvent(generation: number, event: VoiceClientEvent) {
    if (generation !== this.session.generation) return;
    if (event === 'failed') {
      this.notice = 'I couldn’t use the microphone.';
      this.dispatch({ type: 'failed', generation });
    } else if (event === 'capture-ready') {
      this.dispatch({ type: 'capture-ready', generation });
      if (this.session.mode === 'push-to-talk') {
        if (!this.utterance) this.beginUtterance();
      } else this.armIdle();
    } else if (event === 'speech-detected') {
      if (!this.utterance) this.beginUtterance();
      this.utterance!.epoch++;
      clearTimeout(this.idleTimer);
      this.dispatch({ type: 'speech-detected', generation });
    } else if (event === 'pause' || event === 'long-pause') {
      void this.decide(event === 'long-pause');
    } else if (event === 'captured') {
      void this.finishHold();
    }
  }

  /** Microphone audio of the current utterance, 16 kHz PCM16. */
  pcm(generation: number, pcm: Uint8Array) {
    if (generation === this.session.generation) this.utterance?.transcriber.push(pcm);
  }

  /**
   * Play a short voice sample (Settings → Voice) through the same speaker path as replies. Only
   * while voice is idle; Stop or a new hold cancels it like any reply. An expressive sample's
   * laugh or chuckle is performed in time, like a reply's.
   */
  async preview(text: string, speak: Speak, expressive = false) {
    if (!this.available || this.session.phase !== 'idle' || this.reply || this.previewing)
      return false;
    const abort = new AbortController();
    this.previewing = abort;
    const { generation, turn } = this.session;
    // A fresh playback token, so the sample never queues behind the end of an older reply.
    this.deps.send({ type: 'stop-audio' });
    try {
      await this.speakClip(
        generation,
        turn,
        text,
        abort.signal,
        speak,
        expressive,
        (samples, rate) => this.play(generation, turn, samples, rate, abort.signal),
      );
      return true;
    } finally {
      if (this.previewing === abort) this.previewing = undefined;
    }
  }

  played(generation: number, turn: number) {
    if (generation !== this.session.generation || this.pendingAck?.turn !== turn) return;
    const ack = this.pendingAck;
    this.pendingAck = undefined;
    ack.resolve();
  }

  private beginUtterance() {
    this.utterance?.transcriber.close();
    this.utterance = { transcriber: this.deps.listen(), epoch: 0 };
  }

  private endUtterance(notify: boolean) {
    const utterance = this.utterance;
    this.utterance = undefined;
    utterance?.transcriber.close();
    if (notify && utterance)
      this.deps.send({ type: 'utterance-done', generation: this.session.generation });
  }

  /**
   * Hands-free end of turn. At a short pause the words so far decide: a finished-sounding request
   * is answered now, "can you… um" waits. A long pause ends the turn whatever was said.
   */
  private async decide(long: boolean) {
    const utterance = this.utterance;
    const { generation } = this.session;
    if (!utterance || this.session.mode !== 'conversation') return;
    const epoch = utterance.epoch;
    // A recognizer that failed heard nothing; a long pause then ends the turn quietly.
    const heard = await utterance.transcriber.transcript().then(cleanTranscript, () => '');
    // Speech resumed, the utterance was handed off, or the session changed meanwhile.
    if (this.utterance !== utterance || utterance.epoch !== epoch) return;
    if (generation !== this.session.generation) return;
    if (!long && soundsUnfinished(heard)) return;
    this.endUtterance(true);
    this.heard = heard;
    this.dispatch({ type: 'end-of-turn', generation, heard: Boolean(heard) });
    if (!heard && this.session.phase === 'listening') this.armIdle();
  }

  /** Push-to-talk released and the last audio arrived. */
  private async finishHold() {
    const utterance = this.utterance;
    const { generation, turn } = this.session;
    this.utterance = undefined;
    if (!utterance) return;
    if (this.session.phase !== 'processing' || this.session.mode !== 'push-to-talk') {
      utterance.transcriber.close();
      return;
    }
    let heard: string;
    try {
      heard = cleanTranscript(await utterance.transcriber.transcript());
    } catch {
      if (generation !== this.session.generation) return;
      this.notice = 'Voice stopped. Try again.';
      this.dispatch({ type: 'failed', generation });
      return;
    } finally {
      utterance.transcriber.close();
    }
    if (generation !== this.session.generation || turn !== this.session.turn) return;
    await this.runTurn(heard);
  }

  /** One request: screens if needed → agent → spoken acknowledgement, progress and answer. */
  private async runTurn(heard: string) {
    const { generation, turn } = this.session;
    const reply: Reply = { turn, abort: new AbortController(), paused: false };
    this.reply = reply;
    const { signal } = reply.abort;
    const ended = (notice?: string) => {
      if (this.reply === reply) this.reply = undefined;
      this.notice = notice;
      this.dispatch({ type: 'reply-ended', generation, turn });
      if (this.session.mode === 'conversation' && this.session.phase === 'listening')
        this.armIdle();
    };
    let timer: ReturnType<typeof setInterval> | undefined;
    try {
      if (!heard) return ended('I didn’t catch that.');
      const expressiveVoice = this.deps.expressiveVoice?.() ?? false;
      const speakAloud = this.deps.speakReplies?.() !== false;
      let audible = false;
      // The voice connects now, while screens are captured and the model starts thinking.
      const voice = speakAloud
        ? this.openVoice(generation, turn, signal, expressiveVoice, () => {
            // Edi looks like it is speaking only once there is sound. Synthesis can take
            // seconds, and until the first samples arrive the bubble keeps showing thinking.
            if (audible) return;
            audible = true;
            this.dispatch({ type: 'reply-started', generation, turn });
          })
        : null;

      const screens = await this.deps.captureScreens(heard);
      if (signal.aborted) return;
      const runId = await this.deps.ask(heard, { screens, spoken: true, expressiveVoice });
      if (signal.aborted) return;
      if (!runId) return ended('Open Edi to continue.');

      const now = this.deps.now ?? Date.now;
      const progress = new SpokenProgress({ ...progressTiming, ...this.deps.timing });
      let spoken = '';
      let latest: AgentState | undefined;
      const pull = (text: string, final: boolean) => {
        const next = takeSpeech(text, spoken, expressiveVoice, final);
        spoken = next.spoken;
        if (next.say) voice?.say(next.say);
      };
      // Acknowledgements and progress are spoken between the answer's own sentences, never
      // while the person talks over Edi.
      const narrate = () => {
        if (!voice || !latest || reply.paused || signal.aborted) return;
        const line = progress.next(latest, now(), voice.quiet(now()));
        if (line) voice.say(line);
      };
      timer = setInterval(narrate, this.deps.timing?.tickMs ?? 250);

      const result = await this.deps.whenFinished(runId, signal, state => {
        if (state.status === 'error' || state.status === 'stopped') return;
        latest = state;
        // Words written before a tool starts ("Sure, checking.") are said before the tool runs.
        pull(state.text, progress.workStarted(state));
        narrate();
      });
      clearInterval(timer);
      if (signal.aborted) return;
      if (result.status !== 'done') {
        return ended(result.status === 'error' ? spokenFailure(result.error) : undefined);
      }
      if (!speakAloud || !voice) return ended('Answered in Conversations.');
      // A reply that arrived all at once still starts with a short first clip.
      if (!spoken) pull(result.text, false);
      pull(result.text, true);
      await voice.end();
      await voice.drain(() => reply.paused);
      if (!signal.aborted) ended();
    } catch (error) {
      if (signal.aborted) return;
      this.notice =
        error instanceof Error && error.message === 'Set up OpenRouter first.'
          ? error.message
          : 'Voice stopped. Try again.';
      this.dispatch({ type: 'failed', generation });
    } finally {
      clearInterval(timer);
      if (this.reply === reply && signal.aborted) this.reply = undefined;
    }
  }

  /**
   * A stream when the engine has one (the whole reply keeps one delivery and starts sooner),
   * otherwise clip by clip. A stream that fails before any sound hands everything said so far
   * to the clip path, so the person still hears the reply.
   */
  private openVoice(
    generation: number,
    turn: number,
    signal: AbortSignal,
    expressive: boolean,
    onAudio: () => void,
  ): ReplyVoice {
    const now = this.deps.now ?? Date.now;
    let said = 0;
    let lastSayAt = 0;
    let audioEndsAt = now();
    let pendingClips = 0;
    let streamHeard = false;
    let lastAudioAt = 0;
    const consume: Consume = (samples, rate) => {
      onAudio();
      lastAudioAt = now();
      audioEndsAt = Math.max(now(), audioEndsAt) + (samples.length / rate) * 1000;
      return this.play(generation, turn, samples, rate, signal);
    };
    let queue: Promise<void> = Promise.resolve();
    const clip = (text: string) => {
      pendingClips++;
      queue = queue
        .then(() => {
          if (signal.aborted) return;
          return this.speakClip(
            generation,
            turn,
            text,
            signal,
            (words, abort, take) => this.deps.speak(words, abort, take),
            expressive,
            consume,
          );
        })
        .finally(() => pendingClips--);
    };
    // Expression tags are performed per clip, so expressive engines always go clip by clip.
    let stream = expressive
      ? null
      : (this.deps.speechStream?.(signal, (samples, rate) => {
          streamHeard = true;
          return consume(samples, rate);
        }) ?? null);
    const sentToStream: string[] = [];
    // A stream that failed before any sound: everything said so far goes to the clip path.
    const fallBack = () => {
      stream = null;
      for (const text of sentToStream.splice(0)) clip(text);
    };
    return {
      say(text) {
        said++;
        lastSayAt = now();
        if (stream?.failed && !streamHeard) fallBack();
        if (stream) {
          sentToStream.push(text);
          stream.say(text);
        } else clip(text);
      },
      async end() {
        if (stream) {
          try {
            await stream.end();
          } catch {
            // Cut off after it was heard: what was heard stays heard.
            if (signal.aborted || streamHeard) return;
            fallBack();
          }
        }
        await queue;
      },
      async drain(paused) {
        for (;;) {
          if (signal.aborted) return;
          const left = audioEndsAt - now();
          if (left <= 0) return;
          const step = Math.min(left, 100);
          await new Promise(resolve => setTimeout(resolve, step));
          // Held audio does not advance.
          if (paused()) audioEndsAt += step;
        }
      },
      quiet(time) {
        // Text handed to a stream counts as speech until its audio arrives (a few seconds at most).
        const awaitingStream = stream && lastSayAt > lastAudioAt && time - lastSayAt < 3000;
        if (pendingClips > 0 || awaitingStream) return { spokeAnything: said > 0, quietMs: 0 };
        return { spokeAnything: said > 0, quietMs: Math.max(0, time - audioEndsAt) };
      },
    };
  }

  /**
   * Speak one clip. With an expressive voice, a laugh or chuckle starts its own utterance and
   * its cue travels just ahead of that audio, so the character laughs when the voice does.
   */
  private async speakClip(
    generation: number,
    turn: number,
    text: string,
    signal: AbortSignal,
    speak: Speak,
    expressive: boolean,
    consume: Consume,
  ) {
    const segments = expressive ? cueSegments(text) : [{ text, lead: null, trailing: null }];
    for (const segment of segments) {
      if (signal.aborted) return;
      let first = true;
      await speak(segment.text, signal, (samples, rate) => {
        if (first && segment.lead)
          this.deps.send({ type: 'cue', generation, turn, cue: segment.lead, at: 'next' });
        first = false;
        return consume(samples, rate);
      });
      if (segment.trailing && !signal.aborted)
        this.deps.send({ type: 'cue', generation, turn, cue: segment.trailing, at: 'end' });
    }
  }

  /** Resolves once the player accepts the chunk: the speech engine waits on this. */
  private play(
    generation: number,
    turn: number,
    samples: Float32Array,
    rate: number,
    signal: AbortSignal,
  ) {
    return new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      // While the person talks over a reply its audio is held, so the deadline waits too.
      const arm = () => {
        timer = setTimeout(() => {
          if (this.reply?.turn === turn && this.reply.paused) arm();
          else reject(new Error('Playback stalled'));
        }, PLAYBACK_ACK_MS);
      };
      arm();
      this.pendingAck = {
        turn,
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
      };
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new Error('Stopped'));
        },
        { once: true },
      );
      this.deps.send({ type: 'pcm', generation, turn, rate, samples });
    });
  }

  private armIdle() {
    clearTimeout(this.idleTimer);
    if (this.session.mode !== 'conversation') return;
    const { generation } = this.session;
    this.idleTimer = setTimeout(
      () => this.dispatch({ type: 'idle-timeout', generation }),
      this.deps.timing?.idleMs ?? turnTiming.idleMs,
    );
    this.idleTimer.unref?.();
  }

  private dispatch(event: VoiceEvent) {
    const previous = this.session;
    const { state, effects } = transitionVoice(previous, event);
    this.session = state;
    for (const effect of effects) this.apply(effect, previous);
    if (
      state.phase !== previous.phase ||
      state.interrupting !== previous.interrupting ||
      this.notice
    )
      this.render();
  }

  private apply(effect: VoiceEffect, previous: VoiceSession) {
    const generation = this.session.generation;
    if (effect === 'cancel-all') {
      clearTimeout(this.idleTimer);
      this.reply?.abort.abort();
      this.reply = undefined;
      this.previewing?.abort();
      this.previewing = undefined;
      this.pendingAck = undefined;
      this.endUtterance(false);
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
        // Read now: a quick tap may have made this a conversation while permission was checked.
        const mode = this.session.mode ?? 'push-to-talk';
        // Push-to-talk audio can arrive just before `capture-ready`: be ready for it.
        if (mode === 'push-to-talk') this.beginUtterance();
        this.deps.send({ type: 'open', generation, mode });
      });
    } else if (effect === 'close-microphone') {
      this.deps.send({ type: 'finish', generation });
    } else if (effect === 'pause-reply') {
      if (this.reply) this.reply.paused = true;
      this.deps.send({ type: 'pause-audio' });
    } else if (effect === 'resume-reply') {
      if (this.reply) this.reply.paused = false;
      this.deps.send({ type: 'resume-audio' });
    } else if (effect === 'cancel-reply') {
      // Words spoken over Edi: her audio goes, and so does the work behind it. The interrupted
      // request stays in the conversation's history, so "actually, only from Sarah" makes sense.
      this.reply?.abort.abort();
      this.reply = undefined;
      this.pendingAck = undefined;
      this.deps.send({ type: 'stop-audio' });
      this.deps.stopAgent();
    } else if (effect === 'submit-turn' && this.session.mode === 'conversation') {
      void this.runTurn(this.heard);
    }
    // Push-to-talk 'submit-turn': the last audio arrives, then `captured` runs the turn.
  }

  private render() {
    const notice = this.notice;
    this.notice = undefined;
    const { phase, interrupting } = this.session;
    if (notice && (phase === 'idle' || phase === 'error')) this.deps.status({ notice });
    else if (phase === 'opening') this.deps.status('opening');
    else if (phase === 'listening' || interrupting) this.deps.status('listening');
    else if (phase === 'processing') this.deps.status('thinking');
    else if (phase === 'speaking') this.deps.status('speaking');
    else if (phase === 'error' && this.quietError) {
      this.quietError = false;
      this.deps.status('hidden');
    } else if (phase === 'error') this.deps.status({ notice: 'Voice stopped. Try again.' });
    else this.deps.status('hidden');
  }
}
