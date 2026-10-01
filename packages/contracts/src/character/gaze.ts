import { z } from 'zod';
import type { CharacterExpression, CharacterMood } from './expressions';

/**
 * Where the person's pointer is, as seen from Edi: a direction whose length says how far away it
 * is (0 is on top of Edi, 1 is far across the screen). Main computes it from Edi's own window
 * and the pointer, sends it only to the pet window, and nothing else about the pointer is kept.
 */
export const gazeSchema = z
  .object({ x: z.number().min(-1).max(1), y: z.number().min(-1).max(1) })
  .strict();
export type Gaze = z.infer<typeof gazeSchema>;

export const noGaze: Gaze = { x: 0, y: 0 };

/** Distance in points at which the eyes are fully turned; closer pointers turn them less. */
export const gazeFullTurnPoints = 360;
/** Right on top of Edi the pointer has no direction worth following. */
const gazeDeadZonePoints = 14;
/** Steps coarse enough to keep still pointers silent, fine enough to look smooth. */
const gazeStep = 0.02;

const quantize = (value: number) => Math.round(value / gazeStep) * gazeStep || 0;

/** The gaze for a pointer at `cursor` when Edi's eyes are at `origin` (both in screen points). */
export function gazeToward(
  origin: { x: number; y: number },
  cursor: { x: number; y: number },
): Gaze {
  const dx = cursor.x - origin.x;
  const dy = cursor.y - origin.y;
  const distance = Math.hypot(dx, dy);
  if (!Number.isFinite(distance) || distance < gazeDeadZonePoints) return noGaze;
  const turn = Math.min(1, distance / gazeFullTurnPoints);
  return { x: quantize((dx / distance) * turn), y: quantize((dy / distance) * turn) };
}

/** Furthest the pupils travel, in artwork units, before a character's own scale. */
export const gazeReach = { x: 4, y: 2.5 };

/**
 * How much of the pointer's direction the eyes follow in a given state. Edi looks at you when it
 * is idle, listening or pleased; it keeps a loose eye on you while speaking; and when it is
 * thinking, sleepy or puzzled the face already has its own look (up and away, shut, to the side),
 * so following the pointer would contradict what the face is saying.
 */
export function gazeGain(expression: CharacterExpression, mood: CharacterMood): number {
  const byExpression: Record<CharacterExpression, number> = {
    idle: 1,
    listening: 1,
    thinking: 0,
    speaking: 0.55,
    happy: 1,
    attention: 1,
  };
  const byMood: Record<CharacterMood, number> = {
    neutral: 1,
    happy: 1,
    love: 0.8,
    surprised: 0.6,
    annoyed: 0.5,
    sad: 0.3,
    confused: 0,
    sleepy: 0,
  };
  return Math.min(byExpression[expression], byMood[mood]);
}

export interface SpringState {
  position: number;
  velocity: number;
}

/**
 * One step of a damped spring toward `target` (semi-implicit Euler, so it stays stable at any
 * frame rate). Slightly under-damped: an eye that snaps to a new spot settles with a hair of
 * overshoot instead of stopping dead.
 */
export function stepSpring(
  state: SpringState,
  target: number,
  seconds: number,
  stiffness = 260,
  damping = 24,
): SpringState {
  // A stalled frame (a hidden window, a debugger) must not fling the eyes across the face.
  const dt = Math.min(Math.max(seconds, 0), 1 / 20);
  const velocity =
    state.velocity + (stiffness * (target - state.position) - damping * state.velocity) * dt;
  return { position: state.position + velocity * dt, velocity };
}

/** Close enough to rest: nothing left to animate. */
export function springSettled(state: SpringState, target: number, epsilon = 0.01): boolean {
  return Math.abs(target - state.position) < epsilon && Math.abs(state.velocity) < epsilon;
}
