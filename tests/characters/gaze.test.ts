import test from 'node:test';
import assert from 'node:assert/strict';
import {
  characterExpressionSchema,
  characterMoodSchema,
  gazeGain,
  gazeSchema,
  gazeToward,
  noGaze,
  springSettled,
  stepSpring,
  type SpringState,
} from '../../packages/contracts/src/index';

const origin = { x: 500, y: 500 };

test('the gaze points at the pointer and turns further the farther it is', () => {
  const near = gazeToward(origin, { x: 600, y: 500 });
  const far = gazeToward(origin, { x: 1500, y: 500 });
  assert.ok(near.x > 0 && near.x < 1);
  assert.equal(near.y, 0);
  assert.equal(far.x, 1);
  const up = gazeToward(origin, { x: 500, y: 100 });
  assert.ok(up.y < 0);
  assert.equal(up.x, 0);
});

test('the gaze never leaves the unit circle and always passes its own schema', () => {
  for (const [x, y] of [
    [-5000, 3000],
    [5000, 5000],
    [501, 503],
    [0, 0],
  ]) {
    const gaze = gazeToward(origin, { x, y });
    assert.ok(Math.hypot(gaze.x, gaze.y) <= 1.03);
    assert.ok(gazeSchema.safeParse(gaze).success);
  }
});

test('a pointer right on top of Edi, or a broken one, means look straight ahead', () => {
  assert.deepEqual(gazeToward(origin, { x: 503, y: 498 }), noGaze);
  assert.deepEqual(gazeToward(origin, { x: Number.NaN, y: 4 }), noGaze);
  // Never negative zero, which would change the quantized value for nothing.
  assert.ok(Object.is(gazeToward(origin, { x: 900, y: 500 }).y, 0));
});

test('a still pointer gives the same gaze every time, so nothing is sent', () => {
  assert.deepEqual(gazeToward(origin, { x: 812, y: 390 }), gazeToward(origin, { x: 812, y: 390 }));
});

test('the eyes follow when Edi is free, and stay out of the way of its own faces', () => {
  assert.equal(gazeGain('idle', 'neutral'), 1);
  assert.equal(gazeGain('listening', 'neutral'), 1);
  assert.ok(gazeGain('speaking', 'neutral') < 1 && gazeGain('speaking', 'neutral') > 0);
  // Thinking looks up and away; sleepy and confused have their own eyes.
  assert.equal(gazeGain('thinking', 'neutral'), 0);
  assert.equal(gazeGain('idle', 'sleepy'), 0);
  assert.equal(gazeGain('idle', 'confused'), 0);
  assert.ok(gazeGain('idle', 'sad') < gazeGain('idle', 'neutral'));
});

test('every expression and mood has a gain between 0 and 1', () => {
  for (const expression of characterExpressionSchema.options)
    for (const mood of characterMoodSchema.options) {
      const gain = gazeGain(expression, mood);
      assert.ok(gain >= 0 && gain <= 1, `${expression}/${mood}`);
    }
});

function settle(from: SpringState, target: number) {
  let state = from;
  let peak = state.position;
  for (let frame = 0; frame < 600; frame++) {
    state = stepSpring(state, target, 1 / 60);
    peak = Math.max(peak, state.position);
    if (springSettled(state, target)) return { state, frames: frame, peak };
  }
  return { state, frames: 600, peak };
}

test('the spring settles on its target quickly, with only a hint of overshoot', () => {
  const { state, frames, peak } = settle({ position: 0, velocity: 0 }, 4);
  assert.ok(springSettled(state, 4));
  assert.ok(frames < 60, `settled in ${frames} frames`);
  assert.ok(peak < 4 * 1.15, `overshoot peaked at ${peak}`);
});

test('the spring is stable at any frame rate and survives a stalled frame', () => {
  for (const dt of [1 / 240, 1 / 60, 1 / 30, 1 / 10, 5]) {
    let state: SpringState = { position: 0, velocity: 0 };
    for (let i = 0; i < 2000; i++) state = stepSpring(state, 3, dt);
    assert.ok(Math.abs(state.position - 3) < 0.05, `dt ${dt}: ${state.position}`);
  }
});

test('a spring retargeted mid-flight keeps its velocity instead of snapping', () => {
  let state: SpringState = { position: 0, velocity: 0 };
  for (let i = 0; i < 5; i++) state = stepSpring(state, 4, 1 / 60);
  const before = state;
  const after = stepSpring(before, -4, 1 / 60);
  assert.ok(Math.abs(after.position - before.position) < 1);
  assert.ok(after.velocity < before.velocity);
});
