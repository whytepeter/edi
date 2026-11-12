import { useEffect, useRef, type RefObject } from 'react';
import {
  gazeGain,
  gazeReach,
  noGaze,
  springSettled,
  stepSpring,
  type CharacterExpression,
  type CharacterMood,
  type Gaze,
  type SpringState,
} from '@edi/contracts';

/** After this long without the pointer moving, Edi loses interest and its eyes drift again. */
const INTEREST_MS = 8000;

interface GazeOptions {
  expression: CharacterExpression;
  mood: CharacterMood;
  /** The character's own `motion.gaze` times `motion.intensity`. */
  scale: number;
}

/**
 * Turns the pupils toward the pointer. The eyes ride two CSS variables on `target`
 * (--gaze-x, --gaze-y, in artwork units) that a spring moves a frame at a time, straight on the
 * DOM, so a look never re-renders React. `data-gaze` on `target` tells the CSS to hand the pupils
 * over from their idle wander. How far they follow depends on what Edi is doing (see gazeGain),
 * and with reduced motion they stay put.
 */
export function useGaze(target: RefObject<HTMLElement | null>, options: GazeOptions) {
  const { expression, mood, scale } = options;
  const aim = useRef<Gaze>(noGaze);
  const reach = useRef({ x: 0, y: 0 });
  const kick = useRef<() => void>(() => {});

  // What Edi is doing decides how far the eyes may turn. Retarget when it changes.
  useEffect(() => {
    const gain = gazeGain(expression, mood) * scale;
    reach.current = { x: gazeReach.x * gain, y: gazeReach.y * gain };
    kick.current();
  }, [expression, mood, scale]);

  useEffect(() => {
    const element = target.current;
    if (!element) return;
    const quiet = window.matchMedia('(prefers-reduced-motion: reduce)');
    let x: SpringState = { position: 0, velocity: 0 };
    let y: SpringState = { position: 0, velocity: 0 };
    let frame = 0;
    let last = 0;
    let bored: ReturnType<typeof setTimeout> | undefined;
    let engaged = false;

    const goal = () =>
      quiet.matches
        ? { x: 0, y: 0 }
        : { x: aim.current.x * reach.current.x, y: aim.current.y * reach.current.y };

    const write = () => {
      element.style.setProperty('--gaze-x', `${x.position.toFixed(2)}px`);
      element.style.setProperty('--gaze-y', `${y.position.toFixed(2)}px`);
    };

    const step = (now: number) => {
      const to = goal();
      const dt = last ? (now - last) / 1000 : 1 / 60;
      last = now;
      x = stepSpring(x, to.x, dt);
      y = stepSpring(y, to.y, dt);
      if (springSettled(x, to.x) && springSettled(y, to.y)) {
        x = { position: to.x, velocity: 0 };
        y = { position: to.y, velocity: 0 };
        frame = 0;
        last = 0;
        // Back at rest and no longer interested: let the idle wander have the eyes again.
        if (!engaged && to.x === 0 && to.y === 0) element.removeAttribute('data-gaze');
      } else frame = requestAnimationFrame(step);
      write();
    };
    const run = () => {
      if (!frame) frame = requestAnimationFrame(step);
    };
    kick.current = () => {
      if (engaged || frame) run();
    };

    const engage = () => {
      if (engaged) return;
      engaged = true;
      if (!element.hasAttribute('data-gaze')) {
        // Start from wherever the idle wander has the pupils, so taking over never jumps.
        const pupils = element.querySelector('[data-part="pupils"]');
        const matrix = pupils ? new DOMMatrixReadOnly(getComputedStyle(pupils).transform) : null;
        x = { position: matrix && Number.isFinite(matrix.e) ? matrix.e : 0, velocity: 0 };
        y = { position: 0, velocity: 0 };
        write();
        element.setAttribute('data-gaze', '');
      }
    };

    const off = window.edi?.onCharacterGaze(gaze => {
      aim.current = gaze;
      if (quiet.matches) return;
      engage();
      clearTimeout(bored);
      bored = setTimeout(() => {
        engaged = false;
        aim.current = noGaze;
        run();
      }, INTEREST_MS);
      run();
    });
    const onQuietChange = () => run();
    quiet.addEventListener('change', onQuietChange);

    return () => {
      off?.();
      quiet.removeEventListener('change', onQuietChange);
      clearTimeout(bored);
      cancelAnimationFrame(frame);
      kick.current = () => {};
      element.removeAttribute('data-gaze');
      element.style.removeProperty('--gaze-x');
      element.style.removeProperty('--gaze-y');
    };
  }, [target]);
}
