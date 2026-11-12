/**
 * Which model answers a turn. Most of what people ask Edi fits a small, fast model: a question,
 * a lookup, a reminder, what is on the screen. Some of it does not: writing, building, planning,
 * analysing. The person picks an everyday model and, if they want, a second one for hard tasks;
 * this decides, from the request alone, which one a turn goes to. It is deliberately simple and
 * local: no extra model call, nothing to wait for, and the same request always goes the same way.
 */

/** How much a request asks of the model. */
export type TurnWeight = 'light' | 'heavy';

export interface TurnToWeigh {
  prompt: string;
  /** A background task: long, unattended work, where quality matters more than the first word. */
  background?: boolean;
}

/** Said outright: the person wants more thought, whatever the request is. */
const ASKED_FOR_DEPTH =
  /\b(think (hard|harder|carefully|deeply|it through|this through)|in (depth|detail)|detailed|thorough(ly)?|step[- ]by[- ]step|take your time|be careful)\b/i;

/** Verbs that mean producing or reasoning something out, and are rarely small talk. */
const WORK =
  /\b(write|draft|compose|rewrite|build|develop|implement|refactor|debug|analy[sz]e|compare|evaluate|research|investigate|outline|critique|visuali[sz]e|mock ?up|prototype|translate|solve|prove|derive|brainstorm)\b/i;

/** Verbs that are also everyday nouns ("what's the plan?"): heavy only with something to act on. */
const WORK_ON_SOMETHING =
  /\b(plan|review|design|code|organi[sz]e|restructure|optimi[sz]e) (my|our|the|this|that|a|an|out|up|it)\b/i;

/** "Make me a report": a general verb, heavy because of what is being made. */
const MAKE_SOMETHING =
  /\b(make|create|generate|produce|put together|come up with|give me|show me)\b[^.?!\n]{0,60}\b(report|essay|article|post|proposal|strategy|plan|spec|spreadsheet|budget|presentation|deck|game|app|website|page|script|program|function|diagram|chart|dashboard|itinerary|schedule|curriculum|story|poem|email|letter|resume|cv|analysis|comparison|document)\b/i;

/** Small jobs that happen to use a working verb: "write that down", "draft a reminder". */
const CHORE =
  /\b(remind(er|ers)?|write (that|this|it) down|note (that|this|it)? ?down|to-?do|checklist|calendar|event|alarm|timer|open|play|pause|volume)\b/i;

/** How much a turn asks for, from its words alone. */
export function turnWeight(turn: TurnToWeigh): TurnWeight {
  if (turn.background) return 'heavy';
  const prompt = turn.prompt.trim();
  if (ASKED_FOR_DEPTH.test(prompt)) return 'heavy';
  // Pasted material to work through: long, many lines, or code.
  const lines = prompt.split('\n').filter(line => line.trim()).length;
  if (prompt.length > 400 || lines >= 4 || prompt.includes('```')) return 'heavy';
  if (prompt.length < 160 && CHORE.test(prompt)) return 'light';
  if (WORK.test(prompt) || WORK_ON_SOMETHING.test(prompt) || MAKE_SOMETHING.test(prompt))
    return 'heavy';
  return 'light';
}

/**
 * The model a turn goes to: the hard-task model for heavy turns when the person chose one,
 * otherwise their everyday model. With no hard-task model nothing changes.
 */
export function modelForTurn(
  models: { everyday: string; hard: string | null },
  turn: TurnToWeigh,
): string {
  return models.hard && turnWeight(turn) === 'heavy' ? models.hard : models.everyday;
}
