import { replyMood, type CharacterMood as Mood } from '@edi/contracts';

/** The part of the mood layer a turn drives. */
interface MoodLayer {
  readonly current: Mood;
  set(mood: Mood, holdMs?: number): void;
  noteActivity(): void;
}

/** How long a reply's mood stays on Edi's face once nothing more is being said. */
export const moodLingers = {
  /** After an answer that is only read. */
  afterWords: 6_000,
  /** After Edi stops speaking: the voice has already carried it. */
  afterSpeech: 2_500,
  /** After something went wrong. */
  afterFailure: 5_000,
} as const;

/**
 * Whether an answer's words go in the bubble beside Edi.
 *
 * Typed there, they do, as they are written. Asked aloud, Edi answers aloud: its voice is the
 * answer, and beside it there is only the listening, thinking and speaking animation. A bubble
 * with content is for when the person has something to do or to see: a review to approve and
 * content Edi made have bubbles of their own, and the words join them only once the answer is
 * complete and either holds a link (which cannot be heard, only opened) or has nothing to say
 * it (the voice is off or failed), so an answer is never lost.
 */
export function answerShowsWords(turn: {
  spoken: boolean;
  done: boolean;
  voiceIdle: boolean;
  text: string;
}) {
  if (!turn.spoken) return true;
  return turn.done && (turn.voiceIdle || hasLink(turn.text));
}

/**
 * Whether a step's progress line shows beside Edi during a turn asked aloud. Edi says what it is
 * doing, so mostly not; but content it is making is something the person is waiting to see, and
 * a line there says it is coming.
 */
export const spokenTurnShowsStep = (capability: string | undefined) =>
  capability === 'workspace.show' || capability === 'workspace.update';

/** A web address or a Markdown link: something to open, not to hear. */
const hasLink = (text: string) => /\bhttps?:\/\/\S|\]\(\S/.test(text);

type VoiceStatus =
  'opening' | 'listening' | 'thinking' | 'speaking' | 'hidden' | { notice: string };

/**
 * Keeps Edi's face in step with a turn. A mood outranks the listening and thinking faces, so
 * the last answer's mood has to end when the person speaks again or a new request starts;
 * otherwise Edi is still smiling at the previous answer while it listens to the next question.
 *
 * A reply's mood belongs to the reply as the person gets it. Read, that is as its tag streams
 * in. Said aloud, it is when Edi's voice starts: the tag arrives with the first words, seconds
 * before any sound, and a face that lit up then looked like a laugh before the answer. The mood
 * stays for as long as Edi is speaking and fades a little after. Nothing here laughs on its own.
 */
export class ReplyReactions {
  private speaking = false;
  /** The reply's words are complete; only its voice may still be going. */
  private written = false;
  /** This turn was asked aloud, so its answer is Edi's voice. */
  private aloud = false;
  /** How the reply feels, once it has said; shown at once when read, with the voice when aloud. */
  private felt: Mood | null = null;

  constructor(private readonly mood: MoodLayer) {}

  /**
   * The person began to speak, or a request started: the last answer's mood is over. `aloud`
   * when the request was spoken.
   */
  turnBegan(aloud = false) {
    this.written = false;
    this.aloud = aloud;
    this.felt = null;
    this.mood.noteActivity();
    if (this.mood.current !== 'neutral') this.mood.set('neutral');
  }

  /** The reply as written so far. */
  replyGrew(text: string) {
    this.mood.noteActivity();
    const felt = replyMood(text);
    if (!felt) return;
    this.felt = felt;
    // Asked aloud and not yet speaking: the mood waits for the voice.
    if (this.aloud && !this.speaking) return;
    if (felt !== this.mood.current) this.mood.set(felt);
  }

  /** The reply is complete. `text` is '' when it was stopped; `failed` when it went wrong. */
  replyEnded(text: string, failed = false) {
    this.written = true;
    if (failed) {
      this.felt = null;
      return this.mood.set('sad', moodLingers.afterFailure);
    }
    this.felt = replyMood(text) ?? 'neutral';
    if (this.aloud && !this.speaking) return;
    // While Edi is still saying it, the mood stays; voice() lets it fade when the voice stops.
    this.mood.set(this.felt, this.speaking ? undefined : moodLingers.afterWords);
  }

  /** What Edi's voice is doing now. */
  voice(status: VoiceStatus) {
    if (status === 'listening') this.turnBegan();
    const was = this.speaking;
    this.speaking = status === 'speaking';
    // The voice began, or went on after a pause between sentences: the face shows the reply's
    // mood, and a fade that had started is called off.
    if (this.speaking) {
      if (this.felt) this.mood.set(this.felt);
      return;
    }
    if (was && this.written) this.mood.set(this.mood.current, moodLingers.afterSpeech);
  }
}
