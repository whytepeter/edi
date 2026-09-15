/**
 * Turn detection, kept apart from transcription accuracy. The pet renderer measures loudness
 * and reports speech starting and pausing; main reads the words so far at each pause and
 * decides whether the person finished or is only thinking ("Can you… um… check my calendar").
 */

export const turnTiming = {
  /** Silence after speech before main checks whether the words sound finished. */
  pauseMs: 600,
  /** Silence that ends a turn whatever the words, e.g. a trailing "and…" nobody finished. */
  longPauseMs: 1800,
  /** Hands-free listening ends after this long with nobody speaking. */
  idleMs: 30_000,
} as const;

export type SpeechActivityEvent = 'speech' | 'pause' | 'long-pause';

export interface SpeechActivityOptions {
  pauseMs?: number;
  longPauseMs?: number;
  /** Speech needed to count as someone talking; longer while Edi's own voice is playing. */
  onsetMs?: number;
  onsetWhileSpeakingMs?: number;
}

/** Hesitations, and words a sentence cannot end on, mean the person is still going. */
const fillers = new Set(['um', 'uh', 'er', 'erm', 'hmm', 'mm', 'ah']);
/** No sentence ends on these, even when the transcriber put a full stop after them. */
// prettier-ignore
const joiners = new Set([
  'and', 'but', 'or', 'so', 'because', 'cause', 'if', 'whether', 'than', 'the', 'a', 'an', 'to',
  'of', 'for', 'with', 'from', 'about', 'into', 'at', 'my', 'your', 'our', 'their', 'can', 'could',
  'would', 'should', "let's",
]);
/** Unpunctuated, these usually mean more is coming ("check emails from"). */
// prettier-ignore
const leaning = new Set([
  'then', 'when', 'while', 'which', 'who', 'as', 'by', 'his', 'her', 'its', 'some', 'any', 'will',
  'shall', 'may', 'might', 'must', 'like', 'also', 'just', 'let', "i'm", 'i',
]);
const lastWord = (text: string) =>
  text
    .split(/\s+/)
    .at(-1)
    ?.toLowerCase()
    .replace(/[^a-z']/g, '') ?? '';

/** True when the words so far end mid-thought: a filler, a joining word, a comma or an ellipsis. */
export function soundsUnfinished(transcript: string) {
  const text = transcript.trim();
  if (!text) return true;
  if (/(?:\.\.\.|…|,|;|:|-|—|–)$/.test(text)) return true;
  const last = lastWord(text);
  if (fillers.has(last)) return true;
  // A question or exclamation mark is a finished thought.
  if (/[?!]$/.test(text)) return false;
  // Whisper often closes a hesitation with a full stop ("Can you."): only true joiners count then.
  if (/\.$/.test(text)) return joiners.has(last);
  return joiners.has(last) || leaning.has(last);
}

/**
 * Loudness-based speech activity with an adaptive noise floor. The microphone already has
 * echo cancellation; while Edi speaks the threshold rises and speech must last longer, so her
 * own voice leaking back does not interrupt her.
 */
export class SpeechActivity {
  private floor = 0.004;
  private voicedMs = 0;
  private silentMs = 0;
  private inSpeech = false;
  private paused = false;
  private longPaused = false;
  private readonly pauseMs: number;
  private readonly longPauseMs: number;
  private readonly onsetMs: number;
  private readonly onsetWhileSpeakingMs: number;

  constructor(options: SpeechActivityOptions = {}) {
    this.pauseMs = options.pauseMs ?? turnTiming.pauseMs;
    this.longPauseMs = options.longPauseMs ?? turnTiming.longPauseMs;
    this.onsetMs = options.onsetMs ?? 160;
    this.onsetWhileSpeakingMs = options.onsetWhileSpeakingMs ?? 320;
  }

  /** Whether an utterance is under way (speech seen and no long pause since). */
  get active() {
    return this.inSpeech;
  }

  /** The utterance was handed off: wait for new speech. */
  reset() {
    this.inSpeech = false;
    this.paused = false;
    this.longPaused = false;
    this.voicedMs = 0;
    this.silentMs = 0;
  }

  /** One frame of microphone input: its RMS level and duration. */
  frame(rms: number, ms: number, edisSpeaking = false): SpeechActivityEvent[] {
    const threshold = edisSpeaking
      ? Math.max(0.03, this.floor * 6)
      : Math.max(0.012, this.floor * 3);
    const voiced = rms > threshold;
    if (!voiced && !this.inSpeech) {
      // The room's noise floor follows quiet frames slowly, and never from speech.
      this.floor += (Math.min(rms, 0.05) - this.floor) * 0.02;
    }
    const events: SpeechActivityEvent[] = [];
    if (voiced) {
      this.voicedMs += ms;
      const needed = this.inSpeech ? 120 : edisSpeaking ? this.onsetWhileSpeakingMs : this.onsetMs;
      if (this.voicedMs >= needed) {
        this.silentMs = 0;
        if (!this.inSpeech || this.paused) events.push('speech');
        this.inSpeech = true;
        this.paused = false;
        this.longPaused = false;
      }
    } else {
      // Short dips between syllables do not reset the onset count completely.
      this.voicedMs = Math.max(0, this.voicedMs - ms * 2);
      if (this.inSpeech) {
        this.silentMs += ms;
        if (!this.paused && this.silentMs >= this.pauseMs) {
          this.paused = true;
          events.push('pause');
        }
        if (!this.longPaused && this.silentMs >= this.longPauseMs) {
          this.longPaused = true;
          this.inSpeech = false;
          events.push('long-pause');
        }
      }
    }
    return events;
  }
}
