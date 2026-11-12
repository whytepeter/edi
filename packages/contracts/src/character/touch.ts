import type { CharacterMood } from './expressions';

/**
 * How Edi answers being touched. A press squashes it a little and letting go springs back with a
 * small stretch; being dragged lifts it and it leans against the motion; poking it over and over
 * wears its patience down (surprised, then annoyed, then rattled).
 */

/** Pokes closer together than this count as one run; a longer pause starts over. */
export const pokeRunMs = 2200;

/** What Edi's face does at the nth poke of a run: nothing for the first two, then it escalates. */
export function pokeReaction(count: number): { mood: CharacterMood; holdMs: number } | null {
  if (count >= 8) return { mood: 'confused', holdMs: 2600 };
  if (count >= 5) return { mood: 'annoyed', holdMs: 2200 };
  if (count >= 3) return { mood: 'surprised', holdMs: 1100 };
  return null;
}

/** Waking a sleepy Edi with a poke is a startle, not an escalation. */
export const wakeReaction = { mood: 'surprised', holdMs: 1100 } as const;

export const maxTiltDegrees = 6;
/** Pointer speed, in points a second, that tips Edi all the way over. */
const fullTiltSpeed = 900;

/** Edi leans against the way it is dragged, as if its top lagged behind its base. */
export function tiltFor(velocityX: number): number {
  if (!Number.isFinite(velocityX)) return 0;
  const lean = (-velocityX / fullTiltSpeed) * maxTiltDegrees;
  return Math.max(-maxTiltDegrees, Math.min(maxTiltDegrees, lean)) || 0;
}

/** Spring settings per motion: firm for a press, loose for a lift, wobbly for the lean. */
export const touchSprings = {
  squash: { stiffness: 420, damping: 26 },
  lift: { stiffness: 220, damping: 16 },
  tilt: { stiffness: 170, damping: 9 },
} as const;

/** How far each touch moves Edi, as a fraction of its size (tilt is in degrees). */
export const touchAmounts = { press: 0.06, hold: 0.035, lift: 0.03, rebound: 0.9 } as const;
