/**
 * Jev in shadow mode: Edi's own checks still make every decision, and Jev is asked the same
 * question beside them, so the two can be compared on real use before Jev is trusted with any.
 * Two checks are compared: whether a prompt needs a screenshot, and whether a hands-free pause
 * ends the turn.
 *
 * Development runs only, and only when turned on with `EDI_JEV_SHADOW=on` and `TYPESAFE_API_KEY`.
 * The words of each checked prompt or utterance then go to TypeSafe, and each comparison, words
 * included, is added to a local JSON Lines file. `pnpm jev:report` summarizes that file.
 */

import { appendFile } from 'node:fs/promises';
import type { PauseOutcome } from '../voice/voice-controller';
import { JevClient, type JevAnswer, type YesNoQuestion } from './client';

/** Checks beyond this many waiting on Jev are skipped rather than queued. */
const MAX_IN_FLIGHT = 4;
/** A pause whose outcome never arrives (the conversation stopped) is written without one. */
const OUTCOME_WAIT_MS = 10_000;

export const screenQuestion: YesNoQuestion = {
  instructions:
    'A person typed or said this request to Edi, an assistant on their Mac that can take a ' +
    'screenshot before answering. Decide whether answering it well needs a fresh look at their ' +
    'screen: something they refer to as this or that, a window, page, error, image or control, ' +
    'or a short follow-up about the screen when their previous turn used it.',
  criteria: {
    true: 'Needs a screenshot of the current screen',
    false: 'Can be answered without seeing the screen',
  },
};

export const turnQuestion: YesNoQuestion = {
  instructions:
    'A person is talking to a voice assistant and has just paused for about half a second. ' +
    'These are their words so far, transcribed automatically, so punctuation may be wrong. ' +
    'Decide whether they have finished what they wanted to say.',
  criteria: {
    true: 'Finished: a complete request, question or remark the assistant can answer now',
    false: 'Unfinished: they stopped mid-thought and will probably keep talking',
  },
};

/** What followed a judged pause; a pause judged finished was answered at once. */
export type TurnOutcome = PauseOutcome | { next: 'answered' } | { next: 'unknown' };

export type ShadowRecord =
  | {
      kind: 'screen';
      at: number;
      prompt: string;
      /** The turn before used the screen. */
      followUp: boolean;
      /** Edi's decision: take a screenshot. */
      heuristic: boolean;
      jev: JevAnswer | 'skipped';
    }
  | {
      kind: 'turn';
      at: number;
      heard: string;
      /** Edi's decision at the pause. */
      heuristic: 'finished' | 'unfinished';
      outcome: TurnOutcome;
      jev: JevAnswer | 'skipped';
    };

export class JevShadow {
  private inFlight = 0;

  constructor(
    private readonly jev: Pick<JevClient, 'yesNo'>,
    private readonly write: (record: ShadowRecord) => void,
    private readonly now: () => number = Date.now,
    private readonly outcomeWaitMs = OUTCOME_WAIT_MS,
  ) {}

  /** The screen gate decided `needed` for `prompt`. */
  screenGate(prompt: string, followUp: boolean, needed: boolean) {
    const at = this.now();
    const state = { request: prompt, previous_turn_used_screen: followUp ? 'yes' : 'no' };
    void this.ask(state, screenQuestion).then(jev =>
      this.write({ kind: 'screen', at, prompt, followUp, heuristic: needed, jev }),
    );
  }

  /**
   * A hands-free pause was judged. Returns where to report what followed an unfinished verdict;
   * the record is written once both Jev's answer and that outcome are known.
   */
  endOfTurn(heard: string, unfinished: boolean): (outcome: PauseOutcome) => void {
    let report: (outcome: PauseOutcome) => void = () => {};
    // Noise heard as nothing is not a question for Jev.
    if (!heard.trim()) return report;
    const at = this.now();
    const outcome = unfinished
      ? new Promise<TurnOutcome>(resolve => {
          const timer = setTimeout(() => resolve({ next: 'unknown' }), this.outcomeWaitMs);
          report = next => {
            clearTimeout(timer);
            resolve(next);
          };
        })
      : Promise.resolve<TurnOutcome>({ next: 'answered' });
    void Promise.all([this.ask({ words_so_far: heard }, turnQuestion), outcome]).then(
      ([jev, next]) =>
        this.write({
          kind: 'turn',
          at,
          heard,
          heuristic: unfinished ? 'unfinished' : 'finished',
          outcome: next,
          jev,
        }),
    );
    return report;
  }

  private async ask(
    state: Record<string, string>,
    question: YesNoQuestion,
  ): Promise<JevAnswer | 'skipped'> {
    if (this.inFlight >= MAX_IN_FLIGHT) return 'skipped';
    this.inFlight++;
    try {
      return await this.jev.yesNo(state, question);
    } finally {
      this.inFlight--;
    }
  }
}

/** Adds each record as one line of JSON; a failed write loses that record and nothing else. */
export function appendJsonLines(path: string) {
  return (record: ShadowRecord) => {
    appendFile(path, `${JSON.stringify(record)}\n`).catch(() => {});
  };
}

/** The shadow when this development run turned it on; otherwise null, and nothing is sent. */
export function jevShadowFromEnv(options: {
  packaged: boolean;
  logPath: string;
  env?: Record<string, string | undefined>;
}): JevShadow | null {
  const env = options.env ?? process.env;
  const key = env.TYPESAFE_API_KEY?.trim();
  if (options.packaged || env.EDI_JEV_SHADOW !== 'on' || !key) return null;
  return new JevShadow(new JevClient(key), appendJsonLines(options.logPath));
}
