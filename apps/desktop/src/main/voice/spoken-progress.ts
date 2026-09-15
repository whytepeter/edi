import type { AgentState } from '@edi/contracts';
import { activeWork, stepLabels } from '../agent/step-labels';

export interface ProgressTiming {
  /** Silence while one step runs before Edi says what it is doing. */
  stepQuietMs: number;
  /** Silence before a general "still working" line. */
  stillQuietMs: number;
}

export const progressTiming: ProgressTiming = { stepQuietMs: 3500, stillQuietMs: 9000 };

/** Looking something up versus doing something, for the acknowledgement's wording. */
const lookup = /(?:^|[._])(?:list|search|read|events|fetch|get|find|inspect|query|check)/i;

const acknowledgements = {
  lookup: ['Let me check.', 'Sure, checking.', 'One sec, let me look.', 'Okay, looking now.'],
  action: ['On it.', 'Sure, on it.', 'Okay, doing that now.', 'Sure thing.'],
};
const still = ['Still working on it.', 'Almost there, give me a second.', 'Bear with me a moment.'];

export interface SpeechQuiet {
  /** Something was already said (or queued) in this turn. */
  spokeAnything: boolean;
  /** Milliseconds since the last audio finished playing; 0 while speech is playing or queued. */
  quietMs: number;
}

/**
 * What Edi says aloud while a spoken request is being worked on, apart from the answer itself:
 * a quick acknowledgement when a tool starts (if the model did not already say one), what it
 * is doing when a step stays quiet for a while, and one "still working" line for long waits.
 * Everything here is speech only; the bubble keeps its own progress line.
 */
export class SpokenProgress {
  private acknowledged = false;
  private narrated = new Set<string>();
  private lines = 0;
  private saidStill = false;
  private askedApproval = false;
  private workSince = new Map<string, number>();

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
    state: Pick<AgentState, 'steps' | 'activity' | 'approval'>,
    now: number,
    speech: SpeechQuiet,
  ): string | null {
    const work = activeWork(state);
    if (work && !this.workSince.has(work.id)) this.workSince.set(work.id, now);
    if (state.approval) {
      if (this.askedApproval || speech.quietMs === 0) return null;
      this.askedApproval = true;
      this.acknowledged = true;
      return 'I need your okay for that.';
    }
    if (!work || work.status !== 'running') return null;
    if (!this.acknowledged && !speech.spokeAnything) {
      this.acknowledged = true;
      const options = lookup.test(work.capability)
        ? acknowledgements.lookup
        : acknowledgements.action;
      return options[this.pick(options.length)] ?? null;
    }
    this.acknowledged = true;
    const quiet = Math.min(speech.quietMs, now - (this.workSince.get(work.id) ?? now));
    if (quiet >= this.timing.stepQuietMs && !this.narrated.has(work.id) && this.lines < 2) {
      this.narrated.add(work.id);
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
