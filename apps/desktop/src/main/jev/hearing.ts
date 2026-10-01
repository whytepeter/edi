/**
 * Jev sorting what an open microphone heard: words said to Edi, and the room around them (a
 * television, a video, a call on speaker, someone else talking). Hands-free turns only; a hold is
 * deliberate and keeps every word. One request asks whether the words were for Edi at all and,
 * when there are several sentences, which of them were, so a turn costs one round trip whatever
 * its length (0.6–1.2 s measured from Lagos).
 *
 * Words go only when Jev is sure they were not for Edi. An unsure, slow or failed answer keeps
 * them, because ignoring the person is worse than answering the television. Development runs only:
 * with `EDI_JEV=on` the verdict is only recorded and Edi never waits for it (Jev's first run scored
 * the person's own words 0.16–0.32 and dropped one); `EDI_JEV=decide` acts on it. Each judgement,
 * words included, is added to the Jev log for `pnpm jev:report`.
 */

import type { JevAnswers, JevClient, YesNoQuestion } from './client';

/**
 * Past this, Edi answers with every word rather than keep the person waiting. Jev took 0.6–1.2 s
 * from Lagos (OpenRouter's own 213 ms median leaves out the trip); 600 ms let almost every check
 * time out.
 */
const ANSWER_WITHIN_MS = 1_500;
/** Words go when Jev puts the chance they were for Edi below this. */
const NOT_FOR_EDI_BELOW = 0.2;
/** The same for one sentence inside words that were for Edi. */
const STRAY_BELOW = 0.2;
/** Past this many sentences, a turn is judged whole only. */
const MAX_SENTENCES = 8;
/** How much of the conversation Jev reads: the end of Edi's reply, the person's last request. */
const REPLY_CHARS = 400;
const REQUEST_CHARS = 200;

export const forEdiQuestion: YesNoQuestion = {
  instructions:
    'An open microphone next to a person at their Mac picked up `heard`, transcribed ' +
    'automatically. Were these words said to Edi, their voice assistant, as part of ' +
    '`conversation`? A television, video, song, phone call, or another person in the room ' +
    'talking to someone else is not Edi being spoken to.',
  criteria: {
    true: 'Said to Edi: a request, question, answer or remark for the assistant',
    false: 'Background: picked up from the room, not said to the assistant',
  },
};

/** One sentence of `heard`, judged against the rest. */
export function sentenceQuestion(sentence: string): YesNoQuestion {
  return {
    instructions: {
      sentence,
      question:
        'Is `sentence` part of what the person said to Edi in `heard`, rather than background ' +
        'speech the microphone also picked up?',
    },
  };
}

export interface HearingContext {
  /** The companion's name: words that use it were said to her. */
  name: string;
  /** What Edi said last, or is saying now when `interrupting`. */
  lastReply: string;
  lastRequest: string;
  /** The words were spoken over Edi's reply. */
  interrupting: boolean;
}

export interface HearingRecord {
  kind: 'heard';
  at: number;
  heard: string;
  interrupting: boolean;
  /** What Jev keeps: every word, the sentences for Edi, or '' when none were. */
  kept: string;
  /** Edi went on with `kept`; false when it was only recorded and every word went on. */
  decided: boolean;
  jev:
    | { ok: true; forEdi: number; sentences: number[]; ms: number }
    | { ok: false; error: string; ms: number };
}

export class JevHearing {
  constructor(
    private readonly jev: Pick<JevClient, 'ask'>,
    private readonly write: (record: HearingRecord) => void,
    /** False: Jev's verdict is only recorded, and every word goes on at once. */
    readonly decides: boolean,
    private readonly now: () => number = Date.now,
    private readonly answerWithinMs = ANSWER_WITHIN_MS,
  ) {}

  /**
   * The words said to Edi, with the room taken out: '' when none of them were for her. Recording
   * only, every word, straight away, while Jev's verdict is written beside them.
   */
  async sift(heard: string, context: HearingContext): Promise<string> {
    // Saying her name is talking to her; there is nothing to ask.
    if (!heard.trim() || namesCompanion(heard, context.name)) return heard;
    const verdict = this.judge(heard, context);
    return this.decides ? verdict : heard;
  }

  /** What Jev keeps of `heard`, written to the log. Never rejects. */
  private async judge(heard: string, context: HearingContext): Promise<string> {
    const sentences = splitSentences(heard);
    const each = sentences.length > 1 && sentences.length <= MAX_SENTENCES;
    const questions: Record<string, YesNoQuestion> = { for_edi: forEdiQuestion };
    if (each)
      sentences.forEach((sentence, index) => {
        questions[`sentence_${index}`] = sentenceQuestion(sentence);
      });
    const at = this.now();
    const answers: JevAnswers<string> = await this.jev.ask(
      {
        heard,
        conversation: {
          edi_said_last: tail(context.lastReply, REPLY_CHARS) || 'nothing yet',
          person_asked_before: head(context.lastRequest, REQUEST_CHARS) || 'nothing yet',
          edi_was_speaking: context.interrupting ? 'yes, and these words came over her' : 'no',
        },
      },
      questions,
      this.answerWithinMs,
    );
    const record = {
      kind: 'heard',
      at,
      heard,
      interrupting: context.interrupting,
      decided: this.decides,
    } as const;
    if (!answers.ok) {
      this.write({ ...record, kept: heard, jev: answers });
      return heard;
    }
    const forEdi = answers.yes.for_edi!;
    const scores = each ? sentences.map((_, index) => answers.yes[`sentence_${index}`]!) : [];
    let kept = heard;
    if (forEdi < NOT_FOR_EDI_BELOW) kept = '';
    else if (each) {
      const own = sentences.filter((_, index) => scores[index]! >= STRAY_BELOW);
      // For Edi, yet no sentence was: the two answers disagree, so every word stays.
      if (own.length) kept = own.join(' ');
    }
    this.write({ ...record, kept, jev: { ok: true, forEdi, sentences: scores, ms: answers.ms } });
    return kept;
  }
}

function namesCompanion(text: string, name: string) {
  const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (
    Boolean(escaped) &&
    new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').test(text)
  );
}

function splitSentences(text: string) {
  const sentences = text.match(/[^.!?]+[.!?]*/g)?.map(sentence => sentence.trim()) ?? [];
  const found = sentences.filter(Boolean);
  return found.length ? found : [text.trim()];
}

const flat = (text: string) => text.replace(/\s+/g, ' ').trim();
/** The end of `text`, cut at a word. */
function tail(text: string, max: number) {
  const all = flat(text);
  return all.length > max ? `…${all.slice(-max).replace(/^\S*\s/, '')}` : all;
}
/** The start of `text`, cut at a word. */
function head(text: string, max: number) {
  const all = flat(text);
  return all.length > max ? `${all.slice(0, max).replace(/\s\S*$/, '')}…` : all;
}
