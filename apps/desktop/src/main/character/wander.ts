import { clampWindow, wanderDelay, wanderStep, wanderTarget, type Rect } from '@edi/contracts';

/** The little of a window that wandering needs, so it runs (and is tested) without Electron. */
interface Movable {
  getBounds(): Rect;
  setBounds(bounds: Rect): void;
  isDestroyed(): boolean;
}

interface WandererOptions {
  pet: Movable;
  /** The part of the screen the character may walk on, for where it is now. */
  area(bounds: Rect): Rect;
  /** The person switched wandering on, and motion is not reduced. */
  enabled(): boolean;
  /**
   * Nothing is happening: Edi is visible and idle, with no card, bubble, menu, drag, voice or
   * work in progress. Asked before a stroll starts and on every frame of one.
   */
  idle(): boolean;
  /** The person has hold of Edi (a drag): even a hop they asked for stops. */
  held?(): boolean;
  /** Where it came to rest, so the next launch finds it there. */
  save(point: { x: number; y: number }): void;
  /**
   * Edi left the ground ('up') or touched down ('land'), going right (1) or left (-1), so the
   * character can show the hop in its own shape. A stroll cut short in the air still lands.
   */
  hop?(phase: 'up' | 'land', direction: 1 | -1): void;
  random?: () => number;
  now?: () => number;
  /** Milliseconds between frames; tests use a coarse one. */
  frameMs?: number;
}

/**
 * Edi hopping along the screen when nothing is going on. Everything the person does comes
 * first: a stroll never starts unless Edi is idle, and one under way stops where it is on the
 * very next frame once that is no longer true. It only ever moves Edi's own window.
 */
export class Wanderer {
  private rest?: ReturnType<typeof setTimeout>;
  private frame?: ReturnType<typeof setInterval>;
  /** Set while Edi is off the ground, with the way it is going. */
  private airborne: 1 | -1 | null = null;
  private readonly random: () => number;
  private readonly now: () => number;

  constructor(private readonly options: WandererOptions) {
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
  }

  /** True while a stroll is under way. */
  get walking() {
    return this.frame !== undefined;
  }

  /** Begin (or begin again): the first stroll comes after a rest, never at once. */
  start() {
    this.stop();
    this.schedule();
  }

  /** Stand still now and plan nothing more, e.g. when wandering is switched off or Edi sleeps. */
  stop() {
    clearTimeout(this.rest);
    this.rest = undefined;
    this.halt(false);
  }

  private schedule() {
    clearTimeout(this.rest);
    this.rest = setTimeout(() => this.stroll(), wanderDelay(this.random()));
    this.rest.unref?.();
  }

  /**
   * A stroll the person asked for ("can you hop?"): now, whether or not wandering is switched on
   * and whatever else is going on, since they are watching for it. Only their own hand on Edi
   * stops it. False when there is nowhere to go.
   */
  hopNow() {
    if (this.walking) return true;
    clearTimeout(this.rest);
    return this.stroll(true);
  }

  /** `asked` is a stroll the person requested; otherwise it is Edi's own, when idle. */
  private stroll(asked = false): boolean {
    const { pet } = this.options;
    if (pet.isDestroyed()) return false;
    // Edi's own stroll waits for a quiet moment; one that was asked for does not.
    const stopped = () =>
      asked ? (this.options.held?.() ?? false) : !this.options.enabled() || !this.options.idle();
    // Not now: look again after another rest rather than waiting on the person.
    if (stopped()) {
      this.schedule();
      return false;
    }
    const from = pet.getBounds();
    const to = wanderTarget(from, this.options.area(from), {
      direction: this.random(),
      distance: this.random(),
    });
    if (!to) {
      this.schedule();
      return false;
    }
    const began = this.now();
    const heading = to.x >= from.x ? 1 : -1;
    // Hops, not a glide: each one a low arc, so the window lifts and lands as it goes.
    const area = this.options.area(from);
    this.frame = setInterval(() => {
      if (pet.isDestroyed()) return this.halt(false);
      // The person did something, or wandering was switched off: stay exactly here.
      if (stopped()) return this.halt(true);
      const step = wanderStep(from, to, this.now() - began, from.height);
      if (step.airborne !== (this.airborne !== null))
        this.leaveOrLand(step.airborne ? heading : null);
      // Near the top of the screen there is no room to rise: it stays within the screen.
      pet.setBounds(clampWindow({ ...from, x: step.x, y: step.y }, area));
      if (step.done) this.halt(true);
    }, this.options.frameMs ?? 16);
    this.frame.unref?.();
    return true;
  }

  /** Tells the character it left the ground (which way) or, with null, that it landed. */
  private leaveOrLand(heading: 1 | -1 | null) {
    const direction = heading ?? this.airborne ?? 1;
    this.airborne = heading;
    this.options.hop?.(heading === null ? 'land' : 'up', direction);
  }

  /** End the stroll where it is; `resume` plans the next one. */
  private halt(resume: boolean) {
    const walking = this.frame !== undefined;
    clearInterval(this.frame);
    this.frame = undefined;
    // Stopped in mid-air: its shape still comes back to rest.
    if (this.airborne !== null) this.leaveOrLand(null);
    if (walking && !this.options.pet.isDestroyed()) {
      const { x, y } = this.options.pet.getBounds();
      this.options.save({ x, y });
    }
    if (resume) this.schedule();
  }
}
