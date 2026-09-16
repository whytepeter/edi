/**
 * Turn detection, kept apart from transcription accuracy. Speech starting and pausing comes from
 * loudness and, in hands-free conversations, Silero in main (is it a voice at all); main reads
 * the words so far at each pause and decides whether the person finished or is only thinking
 * ("Can you… um… check my calendar").
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
  /**
   * A voice detector (Silero) says which frames are a voice. Loudness then only has to tell the
   * person up close from other voices in the room, with steady noise measured apart.
   */
  voiceDetector?: boolean;
}

/**
 * With a voice detector: a new turn must stand this far above other voices in the room (a TV,
 * people nearby), and a turn goes on while speech stays above them and above this share of the
 * person's own level. From a sweep over fan, typing, music and background talk.
 */
const ONSET_OVER_VOICES = 2.5;
const KEEP_OVER_VOICES = 1;
const KEEP_OF_SPEAKER = 0.25;

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
 * Speech activity from loudness (with an adaptive noise floor) and, when a voice detector runs,
 * whether the sound is a voice at all: a door, typing or music is loud but not a voice. The
 * microphone already has echo cancellation; while Edi speaks the threshold rises and speech must
 * last longer, so her own voice leaking back (which is a voice) does not interrupt her.
 */
export class SpeechActivity {
  private floor = 0.004;
  /** With a voice detector: steady noise that is not a voice (a fan, music, typing). */
  private noise = 0.002;
  /** With a voice detector: other people's voices in the room, fading when they stop. */
  private voices = 0;
  /** With a voice detector: how loud the person is in this turn, after noise. */
  private speaker = 0;
  private readonly detector: boolean;
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
    // A word takes longer than a cough, a door or a burst of typing (160 ms let those start turns).
    this.onsetMs = options.onsetMs ?? 240;
    this.onsetWhileSpeakingMs = options.onsetWhileSpeakingMs ?? 320;
    this.detector = options.voiceDetector ?? false;
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
    this.speaker = 0;
  }

  /**
   * One frame of microphone input: its RMS level and duration, and whether a voice detector
   * hears a voice in it (true when none runs, so loudness alone decides).
   */
  frame(rms: number, ms: number, edisSpeaking = false, voice = true): SpeechActivityEvent[] {
    const voiced = this.detector
      ? this.heard(rms, edisSpeaking, voice)
      : this.loud(rms, edisSpeaking, voice);
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
          this.speaker = 0;
          events.push('long-pause');
        }
      }
    }
    return events;
  }

  /** Loudness alone: over an adaptive noise floor. */
  private loud(rms: number, edisSpeaking: boolean, voice: boolean) {
    const threshold = edisSpeaking
      ? Math.max(0.03, this.floor * 6)
      : Math.max(0.012, this.floor * 3);
    const voiced = voice && rms > threshold;
    if (!voiced && !this.inSpeech) {
      // The room's noise floor follows quiet frames slowly, and never from speech.
      this.floor += (Math.min(rms, 0.05) - this.floor) * 0.02;
    }
    return voiced;
  }

  /**
   * With a voice detector. What is left of a frame once steady noise is taken out (by power) must
   * stand clearly above other voices in the room to start a turn, so a fan or music no longer
   * drowns the person out and a TV no longer starts turns; a turn goes on while speech stays near
   * the person's own level, so it ends when only the room is left talking.
   */
  private heard(rms: number, edisSpeaking: boolean, voice: boolean) {
    const excess = Math.sqrt(Math.max(0, rms * rms - this.noise * this.noise));
    const needed = this.inSpeech
      ? Math.max(0.006, this.voices * KEEP_OVER_VOICES, this.speaker * KEEP_OF_SPEAKER)
      : Math.max(0.008, this.voices * ONSET_OVER_VOICES);
    // Edi's own voice leaking back is a voice too: while she talks, only a clear voice counts.
    const clear = !edisSpeaking || rms > Math.max(0.03, this.noise * 6);
    const voiced = voice && clear && excess > needed;
    if (!voice) this.noise += (Math.min(rms, 0.2) - this.noise) * (rms > this.noise ? 0.02 : 0.05);
    if (!this.inSpeech && !edisSpeaking) {
      if (voice) this.voices += (Math.min(excess, 0.3) - this.voices) * 0.02;
      else this.voices *= 0.999;
    }
    if (voiced)
      this.speaker = this.speaker ? this.speaker + (excess - this.speaker) * 0.05 : excess;
    return voiced;
  }
}
