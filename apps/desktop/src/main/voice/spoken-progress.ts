import type { AgentState } from '@edi/contracts';
import { activeWork, stepLabels } from '../agent/step-labels';

export interface ProgressTiming {
  /** Silence while one step runs before Edi says what it is doing. */
  stepQuietMs: number;
  /** Silence before a general "still working" line. */
  stillQuietMs: number;
  /**
   * How long after a request starts, with no word and no tool yet, before Edi says a few words
   * so the wait is not silence. Short enough to land before the wait feels long; long enough
   * that a quick answer is never preceded by one.
   */
  thinkQuietMs?: number;
}

export const progressTiming: ProgressTiming = {
  stepQuietMs: 3500,
  stillQuietMs: 9000,
  thinkQuietMs: 1200,
};

/** Looking something up versus doing something, for the acknowledgement's wording. */
const lookup = /(?:^|[._])(?:list|search|read|events|fetch|get|find|inspect|query|check)/i;

const acknowledgements = {
  lookup: ['Let me check.', 'Sure, checking.', 'One sec, let me look.', 'Okay, looking now.'],
  action: ['On it.', 'Sure, on it.', 'Okay, doing that now.', 'Sure thing.'],
};
const still = ['Still working on it.', 'Almost there, give me a second.', 'Bear with me a moment.'];
/** A few quiet words while the answer is slow to start. */
const thinking = ['Let me think.', 'Okay, one sec.', 'Let me see.', 'Give me a second.'];

export interface SpeechQuiet {
  /** Something was already said (or queued) in this turn. */
  spokeAnything: boolean;
  /** Milliseconds since the last audio finished playing; 0 while speech is playing or queued. */
  quietMs: number;
}

/**
 * What Edi says aloud while a spoken request is being worked on, apart from the answer itself:
 * a few words when the answer is slow to start, a quick acknowledgement when a tool starts (if
 * nothing was said yet), what it is doing when a step stays quiet for a while, and one "still
 * working" line for long waits.
 * Everything here is speech only; the bubble keeps its own progress line.
 */
export class SpokenProgress {
  private acknowledged = false;
  private narrated = new Set<string>();
  private lines = 0;
  private saidStill = false;
  private askedApproval = false;
  private workSince = new Map<string, number>();
  /** When this turn was first asked what to say; the slow-start words are timed from here. */
  private began?: number;

  constructor(
    private readonly timing: ProgressTiming = progressTiming,
    private readonly pick: (count: number) => number = count => Math.floor(Math.random() * count),
  ) {}

  /** A tool step began since the last update: text written before it should be spoken now. */
  workStarted(state: Pick<AgentState, 'steps' | 'activity'>) {
    const work = activeWork(state);
    return Boolean(work && !this.workSince.has(work.id));
  }

  next(
    state: Pick<AgentState, 'steps' | 'activity' | 'approval'> & { text?: string },
    now: number,
    speech: SpeechQuiet,
  ): string | null {
    this.began ??= now;
    const work = activeWork(state);
    if (work && !this.workSince.has(work.id)) this.workSince.set(work.id, now);
    if (state.approval) {
      if (this.askedApproval || speech.quietMs === 0) return null;
      this.askedApproval = true;
      this.acknowledged = true;
      return 'I need your okay for that.';
    }
    if (!work) {
      // No word written and no tool started: the model is slow to begin. A few words fill it.
      const waited = now - this.began;
      const quietMs = this.timing.thinkQuietMs;
      if (
        quietMs !== undefined &&
        !this.acknowledged &&
        !speech.spokeAnything &&
        !state.text?.trim() &&
        waited >= quietMs
      ) {
        this.acknowledged = true;
        return thinking[this.pick(thinking.length)] ?? null;
      }
      return null;
    }
    if (work.status !== 'running') return null;
    if (!this.acknowledged && !speech.spokeAnything) {
      this.acknowledged = true;
      const options = lookup.test(work.capability)
        ? acknowledgements.lookup
        : acknowledgements.action;
      return options[this.pick(options.length)] ?? null;
    }
    this.acknowledged = true;
    const quiet = Math.min(speech.quietMs, now - (this.workSince.get(work.id) ?? now));
    // Once per kind of work: writing content and then showing it are one thing to the person.
    if (quiet >= this.timing.stepQuietMs && !this.narrated.has(work.capability) && this.lines < 2) {
      this.narrated.add(work.capability);
      const label = spokenLabel(work.capability, work.title);
      if (label) {
        this.lines++;
        return label;
      }
    }
    if (speech.quietMs >= this.timing.stillQuietMs && !this.saidStill) {
      this.saidStill = true;
      return still[this.pick(still.length)] ?? null;
    }
    return null;
  }
}

/** "Checking your calendar." for Edi's own tools; "Working in Gmail." for a connected app. */
export function spokenLabel(capability: string, title: string) {
  const own = stepLabels[capability];
  if (own) return `${own}.`;
  const app = title.match(/^([^:]{2,30}):/)?.[1]?.trim();
  return app ? `Working in ${app}.` : null;
}
