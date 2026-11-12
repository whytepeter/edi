import { z } from 'zod';
import { clampWindow, type Rect } from './window-placement';

/**
 * Wandering: now and then, when nothing is happening, the character hops a little way along the
 * screen. It is opt-in, never happens while the person is doing anything with Edi, and stops
 * where it is the moment they do. Pure planning lives here; main moves the window.
 */

/** How long Edi stays put between strolls, in milliseconds. */
export const wanderRest = { min: 40_000, max: 110_000 } as const;
/** How far one stroll goes, in logical pixels. */
export const wanderStride = { min: 120, max: 360 } as const;

/**
 * One hop. Swift: about a third of a second in the air. Calm: a low arc, a soft take-off and
 * landing, and a breath on the ground before the next, so it reads as a light skip rather than
 * a bounce.
 */
export const wanderHop = {
  /** Ground covered by one hop, in logical pixels; a stroll is split into hops near this. */
  length: 78,
  /** Time in the air. */
  airMs: 330,
  /** Time on the ground between hops. */
  groundMs: 150,
  /** How high the arc rises, as a share of the character's height. */
  lift: 0.1,
} as const;

/**
 * How a hop shows on the character itself, so it reads as a body jumping and not a picture
 * sliding. In the air it stretches (taller, narrower) and leans a little the way it is going;
 * on landing it squashes for a moment and springs back.
 */
export const wanderShape = {
  /** Stretch in the air, as a fraction of its size. */
  stretch: 0.07,
  /** How hard it lands: the speed the squash spring is given on touching down. */
  landing: 3,
  /** Lean into the hop, in degrees. */
  lean: 3,
} as const;

/** One moment of a hop, sent to the character's window: leaving the ground, or landing. */
export const wanderHopEventSchema = z
  .object({
    phase: z.enum(['up', 'land']),
    /** 1 going right, -1 going left. */
    direction: z.union([z.literal(1), z.literal(-1)]),
  })
  .strict();
export type WanderHopEvent = z.infer<typeof wanderHopEventSchema>;

/** How long to wait before the next stroll; `random` is 0–1. */
export function wanderDelay(random: number) {
  const share = Math.max(0, Math.min(1, random));
  return Math.round(wanderRest.min + share * (wanderRest.max - wanderRest.min));
}

/**
 * Where a stroll ends: sideways along the level the character is on, toward whichever side has
 * more room, never off the screen. Returns null when there is nowhere worth going.
 */
export function wanderTarget(
  bounds: Rect,
  area: Rect,
  random: { direction: number; distance: number },
): { x: number; y: number } | null {
  const room = {
    left: bounds.x - area.x,
    right: area.x + area.width - (bounds.x + bounds.width),
  };
  // Mostly toward the open side; sometimes the other way, so it does not pace one line for ever.
  const toward = room.right >= room.left ? 1 : -1;
  const direction = random.direction < 0.75 ? toward : -toward;
  const stride =
    wanderStride.min +
    Math.max(0, Math.min(1, random.distance)) * (wanderStride.max - wanderStride.min);
  const reach = Math.min(stride, direction === 1 ? room.right : room.left);
  if (reach < 40) {
    // No room that way: try the other, or stay.
    const other = Math.min(stride, direction === 1 ? room.left : room.right);
    if (other < 40) return null;
    const end = clampWindow({ ...bounds, x: bounds.x - direction * other }, area);
    return { x: end.x, y: end.y };
  }
  const end = clampWindow({ ...bounds, x: bounds.x + direction * reach }, area);
  return { x: end.x, y: end.y };
}

/** How many hops a stroll takes: each about `wanderHop.length`, at least one. */
export function wanderHops(from: { x: number; y: number }, to: { x: number; y: number }) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  return Math.max(1, Math.round(distance / wanderHop.length));
}

/** How long a stroll takes: its hops, with a breath on the ground between them. */
export function wanderDuration(from: { x: number; y: number }, to: { x: number; y: number }) {
  const hops = wanderHops(from, to);
  return hops * wanderHop.airMs + (hops - 1) * wanderHop.groundMs;
}

/**
 * Where the character is `elapsed` ms into a stroll. Each hop carries it one share of the way
 * along a low arc: it leaves the ground gently, is quickest mid-air and settles as it lands,
 * then rests on the ground for a moment. `height` is the character's own height, which sets how
 * high it rises. `airborne` says whether it is off the ground right now.
 */
export function wanderStep(
  from: { x: number; y: number },
  to: { x: number; y: number },
  elapsed: number,
  height = 170,
) {
  const hops = wanderHops(from, to);
  const duration = wanderDuration(from, to);
  if (elapsed >= duration) return { x: to.x, y: to.y, done: true, airborne: false };
  const beat = wanderHop.airMs + wanderHop.groundMs;
  const time = Math.max(0, elapsed);
  const hop = Math.min(hops - 1, Math.floor(time / beat));
  const inAir = Math.min(1, (time - hop * beat) / wanderHop.airMs);
  // Smooth in and out along the ground, so a hop neither jerks away nor stops dead.
  const along = (hop + (1 - Math.cos(Math.PI * inAir)) / 2) / hops;
  // A parabola: up and back down to the same level.
  const rise = inAir < 1 ? 4 * inAir * (1 - inAir) * height * wanderHop.lift : 0;
  return {
    x: Math.round(from.x + (to.x - from.x) * along),
    y: Math.round(from.y + (to.y - from.y) * along - rise),
    done: false,
    airborne: inAir > 0 && inAir < 1,
  };
}
