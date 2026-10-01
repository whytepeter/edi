import { useEffect, useMemo, useRef, type RefObject } from 'react';
import {
  springSettled,
  stepSpring,
  tiltFor,
  touchAmounts,
  touchSprings,
  type SpringState,
} from '@edi/contracts';

export interface PetMotion {
  /** The pointer went down on Edi: it squashes a little. */
  press(): void;
  /** Held long enough to talk: it relaxes to a gentler squash. */
  hold(): void;
  /** A quick tap: it springs back with a small stretch. */
  poke(): void;
  /** The pointer became a drag: Edi lifts. */
  lift(): void;
  /** How fast the drag is moving sideways, in points a second: Edi leans against it. */
  drag(velocityX: number): void;
  /** Let go of a drag, a hold or a cancelled press: everything settles back. */
  settle(): void;
}

const still: PetMotion = {
  press() {},
  hold() {},
  poke() {},
  lift() {},
  drag() {},
  settle() {},
};

const rest = (): SpringState => ({ position: 0, velocity: 0 });

/**
 * Edi's body answers touch with springs, so every press and release can be interrupted by the
 * next one without a jump. The springs move three things (squash, lift, lean) and write them as
 * CSS variables on `target`, straight on the DOM; the pet's CSS turns them into scale and
 * rotate. `scale` is how big the motion is for this moment (a character's intensity, halved
 * when sleepy). With reduced motion nothing moves.
 */
export function usePetMotion(target: RefObject<HTMLElement | null>, scale: number): PetMotion {
  const amount = useRef(scale);
  const motion = useRef<PetMotion>(still);

  useEffect(() => {
    amount.current = scale;
  }, [scale]);

  useEffect(() => {
    const element = target.current;
    if (!element) return;
    const quiet = window.matchMedia('(prefers-reduced-motion: reduce)');
    let squash = rest();
    let lift = rest();
    let tilt = rest();
    const goal = { squash: 0, lift: 0, tilt: 0 };
    let frame = 0;
    let last = 0;
    let calm: ReturnType<typeof setTimeout> | undefined;

    const write = () => {
      element.style.setProperty('--pet-sx', (1 + lift.position + squash.position).toFixed(4));
      element.style.setProperty('--pet-sy', (1 + lift.position - squash.position).toFixed(4));
      element.style.setProperty('--pet-tilt', `${tilt.position.toFixed(2)}deg`);
    };
    const step = (now: number) => {
      const dt = last ? (now - last) / 1000 : 1 / 60;
      last = now;
      squash = stepSpring(
        squash,
        goal.squash,
        dt,
        touchSprings.squash.stiffness,
        touchSprings.squash.damping,
      );
      lift = stepSpring(
        lift,
        goal.lift,
        dt,
        touchSprings.lift.stiffness,
        touchSprings.lift.damping,
      );
      tilt = stepSpring(
        tilt,
        goal.tilt,
        dt,
        touchSprings.tilt.stiffness,
        touchSprings.tilt.damping,
      );
      const done =
        springSettled(squash, goal.squash, 0.0005) &&
        springSettled(lift, goal.lift, 0.0005) &&
        springSettled(tilt, goal.tilt, 0.02);
      if (done) {
        squash = { position: goal.squash, velocity: 0 };
        lift = { position: goal.lift, velocity: 0 };
        tilt = { position: goal.tilt, velocity: 0 };
        frame = 0;
        last = 0;
      } else frame = requestAnimationFrame(step);
      write();
    };
    const run = () => {
      if (!frame) frame = requestAnimationFrame(step);
    };
    const move = (change: () => void) => () => {
      if (quiet.matches) return;
      change();
      run();
    };

    motion.current = {
      press: move(() => {
        goal.squash = touchAmounts.press * amount.current;
      }),
      hold: move(() => {
        goal.squash = touchAmounts.hold * amount.current;
      }),
      poke: move(() => {
        goal.squash = 0;
        // Spring through rest into a small stretch, then settle.
        squash = { ...squash, velocity: -touchAmounts.rebound * amount.current };
      }),
      lift: move(() => {
        goal.squash = 0;
        goal.lift = touchAmounts.lift * amount.current;
      }),
      drag: velocityX => {
        if (quiet.matches) return;
        goal.tilt = tiltFor(velocityX) * amount.current;
        // A drag that stops sends no more events, so the lean eases off on its own.
        clearTimeout(calm);
        calm = setTimeout(() => {
          goal.tilt = 0;
          run();
        }, 70);
        run();
      },
      settle: move(() => {
        clearTimeout(calm);
        goal.squash = 0;
        goal.lift = 0;
        goal.tilt = 0;
      }),
    };

    // Turning on Reduce Motion mid-gesture lets everything go back to rest.
    const onQuiet = () => {
      if (quiet.matches) motion.current.settle();
    };
    quiet.addEventListener('change', onQuiet);
    return () => {
      quiet.removeEventListener('change', onQuiet);
      clearTimeout(calm);
      cancelAnimationFrame(frame);
      motion.current = still;
      for (const name of ['--pet-sx', '--pet-sy', '--pet-tilt']) element.style.removeProperty(name);
    };
  }, [target]);

  // One stable object, so handlers never see a stale or missing motion.
  return useMemo<PetMotion>(
    () => ({
      press: () => motion.current.press(),
      hold: () => motion.current.hold(),
      poke: () => motion.current.poke(),
      lift: () => motion.current.lift(),
      drag: velocityX => motion.current.drag(velocityX),
      settle: () => motion.current.settle(),
    }),
    [],
  );
}
