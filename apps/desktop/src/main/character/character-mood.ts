import type { CharacterMood as Mood } from '@edi/contracts';

/** How long without any interaction before the companion gets sleepy. */
export const SLEEPY_AFTER_MS = 20 * 60_000;

/**
 * The mood layer of the character (see @edi/contracts character/expressions). A mood either lasts
 * until replaced (the mood of a reply in progress) or for a while (after a reply, after an
 * error). With nothing happening for a long time the companion gets sleepy, and any
 * interaction wakes it.
 */
export class CharacterMoodController {
  private mood: Mood = 'neutral';
  private holdTimer?: ReturnType<typeof setTimeout>;
  private idleTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly show: (mood: Mood) => void,
    private readonly sleepyAfterMs = SLEEPY_AFTER_MS,
  ) {
    this.noteActivity();
  }

  get current() {
    return this.mood;
  }

  /** Show a mood; with `holdMs` it returns to neutral afterwards. */
  set(mood: Mood, holdMs?: number) {
    clearTimeout(this.holdTimer);
    this.holdTimer = undefined;
    if (mood !== this.mood) {
      this.mood = mood;
      this.show(mood);
    }
    if (holdMs && mood !== 'neutral')
      this.holdTimer = setTimeout(() => {
        if (this.mood === mood) this.set('neutral');
      }, holdMs);
  }

  /** Something happened (a hold, a click, a reply): wake up and restart the idle clock. */
  noteActivity() {
    if (this.mood === 'sleepy') this.set('neutral');
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.set('sleepy'), this.sleepyAfterMs);
  }

  dispose() {
    clearTimeout(this.holdTimer);
    clearTimeout(this.idleTimer);
  }
}
