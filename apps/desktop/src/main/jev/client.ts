/**
 * Jev, TypeSafe AI's decision model. It reads a state and answers named questions with typed
 * values instead of text; a yes/no question ("noul") comes back as how likely the answer is yes.
 * Reached through OpenRouter's System One API with the person's OpenRouter key, so there is no
 * TypeSafe account or second key. https://openrouter.ai/docs/guides/community/typesafe-sdk
 */

const ENDPOINT = 'https://openrouter.ai/api/v1/systemone';
/** One release, not the newest-release alias, so answers stay comparable across a trial. */
const MODEL = 'typesafe/jev-1.13';
/** A decision that takes longer than this would never have been worth waiting for. */
const REQUEST_TIMEOUT_MS = 5_000;

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** What Jev reads: named text fields, nested as deep as the decision needs. */
export type JevState = Record<string, unknown>;

export interface YesNoQuestion {
  /** The question; an object when it carries data of its own, such as one sentence to judge. */
  instructions: string | Record<string, string>;
  criteria?: { true: string; false: string };
}

/** How likely the answer is yes, from 0 to 1, or why there is no answer. Never thrown. */
export type JevAnswer =
  { ok: true; yes: number; ms: number } | { ok: false; error: string; ms: number };

/** The same, for each question of a request, by the id it was asked under. */
export type JevAnswers<Id extends string> =
  { ok: true; yes: Record<Id, number>; ms: number } | { ok: false; error: string; ms: number };

export class JevClient {
  constructor(
    /** Read on each question: the key loads after startup and can change in Settings. */
    private readonly apiKey: () => string,
    private readonly fetchImpl: Fetch = (url, init) => fetch(url, init),
    private readonly now: () => number = Date.now,
  ) {}

  async yesNo(state: JevState, question: YesNoQuestion): Promise<JevAnswer> {
    const answers = await this.ask(state, { answer: question });
    return answers.ok ? { ok: true, yes: answers.yes.answer, ms: answers.ms } : answers;
  }

  /**
   * Several yes/no questions about one state in one request. Jev answers them in parallel, so
   * each one added costs input tokens but hardly any time.
   */
  async ask<Id extends string>(
    state: JevState,
    questions: Record<Id, YesNoQuestion>,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<JevAnswers<Id>> {
    const started = this.now();
    const ms = () => this.now() - started;
    const key = this.apiKey();
    if (!key) return { ok: false, error: 'no OpenRouter key', ms: 0 };
    const ids = Object.keys(questions) as Id[];
    try {
      const response = await this.fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          state,
          questions: Object.fromEntries(ids.map(id => [id, { type: 'noul', ...questions[id] }])),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) return { ok: false, error: `HTTP ${response.status}`, ms: ms() };
      const yes = readNouls(await response.json(), ids);
      if (yes === null) return { ok: false, error: 'unexpected response', ms: ms() };
      return { ok: true, yes, ms: ms() };
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      return { ok: false, error: timedOut ? 'timeout' : String(error), ms: ms() };
    }
  }
}

/** Every asked question's noul, or null when any is missing or out of range. */
function readNouls<Id extends string>(body: unknown, ids: Id[]): Record<Id, number> | null {
  const answers = (body as { answers?: Record<string, { noul?: unknown } | undefined> } | null)
    ?.answers;
  const yes = {} as Record<Id, number>;
  for (const id of ids) {
    const value = answers?.[id]?.noul;
    if (typeof value !== 'number' || value < 0 || value > 1) return null;
    yes[id] = value;
  }
  return yes;
}
