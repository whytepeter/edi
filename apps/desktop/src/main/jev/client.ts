/**
 * Jev, TypeSafe AI's decision model. It reads a state and answers named questions with typed
 * values instead of text; a yes/no question ("noul") comes back as how likely the answer is yes.
 * https://docs.typesafe.ai/api.md
 */

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const MODEL = 'jev-latest';
/** A decision that takes longer than this would never have been worth waiting for. */
const REQUEST_TIMEOUT_MS = 5_000;

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export interface YesNoQuestion {
  instructions: string;
  criteria: { true: string; false: string };
}

/** How likely the answer is yes, from 0 to 1, or why there is no answer. Never thrown. */
export type JevAnswer =
  { ok: true; yes: number; ms: number } | { ok: false; error: string; ms: number };

export class JevClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: Fetch = (url, init) => fetch(url, init),
    private readonly now: () => number = Date.now,
  ) {}

  async yesNo(state: Record<string, string>, question: YesNoQuestion): Promise<JevAnswer> {
    const started = this.now();
    const ms = () => this.now() - started;
    try {
      const response = await this.fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          state,
          questions: { answer: { type: 'noul', ...question } },
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) return { ok: false, error: `HTTP ${response.status}`, ms: ms() };
      const yes = readNoul(await response.json());
      if (yes === null) return { ok: false, error: 'unexpected response', ms: ms() };
      return { ok: true, yes, ms: ms() };
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      return { ok: false, error: timedOut ? 'timeout' : String(error), ms: ms() };
    }
  }
}

function readNoul(body: unknown): number | null {
  const answers = (body as { answers?: { answer?: { noul?: unknown } } } | null)?.answers;
  const value = answers?.answer?.noul;
  return typeof value === 'number' && value >= 0 && value <= 1 ? value : null;
}
