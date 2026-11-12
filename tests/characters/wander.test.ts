import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wanderDelay,
  wanderDuration,
  stepSpring,
  touchAmounts,
  touchSprings,
  wanderHop,
  wanderHops,
  wanderRest,
  wanderShape,
  wanderStep,
  wanderTarget,
} from '../../packages/contracts/src/index';
import { Wanderer } from '../../apps/desktop/src/main/character/wander';

const area = { x: 0, y: 25, width: 1512, height: 920 };
const size = { width: 160, height: 170 };

test('a stroll goes sideways along the level Edi is on, toward the open side, never off screen', () => {
  // Near the left edge: mostly to the right, and its height on the screen does not change.
  const left = { x: 40, y: 700, ...size };
  const right = wanderTarget(left, area, { direction: 0.2, distance: 0.5 });
  assert.deepEqual(right, { x: 280, y: 700 });
  // Sometimes the other way; with little room there it goes only as far as the edge allows.
  assert.deepEqual(wanderTarget(left, area, { direction: 0.9, distance: 1 }), { x: 0, y: 700 });
  // The longest stroll from the right edge stops at the edge of the screen, not beyond it.
  const atRight = { x: 1352, y: 700, ...size };
  const back = wanderTarget(atRight, area, { direction: 0.2, distance: 1 })!;
  assert.equal(back.x, 992);
  assert.ok(back.x >= area.x && back.x + size.width <= area.x + area.width);
  // A screen with no room either way: it stays where it is.
  assert.equal(
    wanderTarget(
      { x: 0, y: 25, ...size },
      { x: 0, y: 25, width: 180, height: 400 },
      { direction: 0.2, distance: 1 },
    ),
    null,
  );
});

test('it rests between strolls, then goes in quick, low hops with a breath between them', () => {
  assert.equal(wanderDelay(0), wanderRest.min);
  assert.equal(wanderDelay(1), wanderRest.max);
  const from = { x: 100, y: 700 };
  const to = { x: 334, y: 700 };
  // 234 px is three hops of 78: each a third of a second in the air, a moment on the ground.
  assert.equal(wanderHops(from, to), 3);
  assert.equal(wanderDuration(from, to), 3 * wanderHop.airMs + 2 * wanderHop.groundMs);
  // A short way is still one whole hop, never a twitch.
  assert.equal(wanderHops(from, { x: 110, y: 700 }), 1);

  const at = (ms: number) => wanderStep(from, to, ms, 170);
  // It starts on the ground where it was, and ends on the ground where it was going.
  assert.deepEqual(at(0), { x: 100, y: 700, done: false, airborne: false });
  assert.deepEqual(at(wanderDuration(from, to)), { x: 334, y: 700, done: true, airborne: false });

  // Mid-hop it is half a hop along, at the top of a low arc: a tenth of its own height.
  const top = at(wanderHop.airMs / 2);
  assert.deepEqual([top.x, top.y, top.airborne], [139, 683, true]);
  // The arc is the same on the way up as on the way down.
  assert.equal(at(wanderHop.airMs * 0.25).y, at(wanderHop.airMs * 0.75).y);

  // Landed, it rests on the ground exactly one hop along until the next.
  const landed = at(wanderHop.airMs + wanderHop.groundMs / 2);
  assert.deepEqual([landed.x, landed.y, landed.airborne], [178, 700, false]);
  assert.deepEqual(
    [at(wanderHop.airMs).x, at(wanderHop.airMs + wanderHop.groundMs - 1).x],
    [178, 178],
  );

  // Calm: it never rises above the top of the arc and never dips below the ground.
  for (let ms = 0; ms <= wanderDuration(from, to); ms += 10) {
    const y = at(ms).y;
    assert.ok(y <= 700 && y >= 683, `y ${y} at ${ms} ms`);
  }
  // Soft take-off: the first tenth of a hop covers less ground than a tenth in the middle.
  const start = at(wanderHop.airMs * 0.1).x - 100;
  const middle = at(wanderHop.airMs * 0.55).x - at(wanderHop.airMs * 0.45).x;
  assert.ok(start < middle, `${start} < ${middle}`);
});

test('a hop shows on the character: a stretch in the air, a visible squash on landing, then rest', () => {
  const { stiffness, damping } = touchSprings.squash;
  const run = (state: { position: number; velocity: number }, goal: number, ms: number) => {
    const seen: number[] = [];
    for (let at = 0; at < ms; at += 4) {
      state = stepSpring(state, goal, 0.004, stiffness, damping);
      seen.push(state.position);
    }
    return { state, seen };
  };
  // In the air (a third of a second) it reaches nearly its full stretch: taller and narrower.
  const air = run({ position: 0, velocity: 0 }, -wanderShape.stretch, wanderHop.airMs);
  assert.ok(air.state.position < -wanderShape.stretch * 0.9, `stretch ${air.state.position}`);
  // Landing pushes it through rest into a squash you can see, but gentler than a press.
  const land = run({ ...air.state, velocity: wanderShape.landing }, 0, 600);
  const squash = Math.max(...land.seen);
  assert.ok(squash > 0.025 && squash < touchAmounts.press, `squash ${squash}`);
  // And it is back at rest well before the next stroll, with no lasting wobble.
  assert.ok(Math.abs(land.state.position) < 0.001, `rest ${land.state.position}`);
  // The squash is over within the breath on the ground, so the next hop starts from rest.
  const afterBreath = run(
    { ...air.state, velocity: wanderShape.landing },
    0,
    wanderHop.groundMs + 150,
  );
  assert.ok(Math.abs(afterBreath.state.position) < 0.02, `after ${afterBreath.state.position}`);
});

function stage(
  options: { enabled?: () => boolean; idle?: () => boolean; held?: () => boolean } = {},
) {
  let bounds = { x: 40, y: 700, ...size };
  const moves: { x: number; y: number }[] = [];
  const saved: { x: number; y: number }[] = [];
  const hops: string[] = [];
  const wanderer = new Wanderer({
    pet: {
      getBounds: () => bounds,
      setBounds: next => {
        bounds = next;
        moves.push({ x: next.x, y: next.y });
      },
      isDestroyed: () => false,
    },
    area: () => area,
    enabled: options.enabled ?? (() => true),
    idle: options.idle ?? (() => true),
    held: options.held,
    save: point => saved.push(point),
    hop: (phase, direction) => hops.push(`${phase} ${direction}`),
    // Rest the shortest time, go right, the shortest stride: 120 px in two hops (0.81 s).
    random: () => 0,
    frameMs: 30,
  });
  return { wanderer, moves, saved, hops, at: () => bounds };
}

test('Edi hops only after a rest, lands back on its level, and its new place is kept', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const { wanderer, moves, saved, hops, at } = stage();
  wanderer.start();
  t.mock.timers.tick(wanderRest.min - 1);
  assert.equal(moves.length, 0, 'it does not set off at once');
  t.mock.timers.tick(1);
  assert.equal(wanderer.walking, true);
  // Time passes a frame at a time, as it does for real.
  const pass = (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 30) t.mock.timers.tick(30);
  };
  // Mid-hop it has left the ground, and the character was told so, with the way it is going.
  pass(150);
  assert.ok(at().y < 700, `in the air at y ${at().y}`);
  assert.deepEqual(hops, ['up 1']);
  pass(810);
  assert.equal(wanderer.walking, false);
  // It lands on the level it started from, two hops along.
  assert.deepEqual([at().x, at().y], [160, 700]);
  assert.deepEqual(saved, [{ x: 160, y: 700 }]);
  // It only ever went forward, and never below the ground it stands on.
  const xs = moves.map(move => move.x);
  assert.deepEqual(
    xs,
    [...xs].sort((a, b) => a - b),
  );
  assert.ok(moves.every(move => move.y <= 700));
  // Two hops means it touched the ground once in between.
  assert.ok(moves.some(move => move.x === 100 && move.y === 700));
  // Each hop shows on the character: up, then down, twice.
  assert.deepEqual(hops, ['up 1', 'land 1', 'up 1', 'land 1']);
  wanderer.stop();
});

test('anything the person does stops it where it stands; it never starts while they are busy', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  let idle = true;
  const { wanderer, moves, saved, hops, at } = stage({ idle: () => idle });
  wanderer.start();
  t.mock.timers.tick(wanderRest.min);
  // Stopped in mid-air on the first hop: the character is still told it landed.
  for (let elapsed = 0; elapsed < 150; elapsed += 30) t.mock.timers.tick(30);
  assert.equal(wanderer.walking, true);
  assert.deepEqual(hops, ['up 1']);
  const where = { x: at().x, y: at().y };
  assert.ok(where.x > 40 && where.x < 100);

  // They start talking, drag it, or open the card.
  idle = false;
  t.mock.timers.tick(30);
  assert.equal(wanderer.walking, false);
  assert.deepEqual({ x: at().x, y: at().y }, where, 'it stays exactly where it was');
  assert.deepEqual(saved, [where]);
  assert.deepEqual(hops, ['up 1', 'land 1']);

  // While they are busy, rests pass and nothing moves.
  const before = moves.length;
  t.mock.timers.tick(wanderRest.max * 3);
  assert.equal(moves.length, before);
  wanderer.stop();
});

test('switched off, or with motion reduced, Edi does not wander at all', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const { wanderer, moves } = stage({ enabled: () => false });
  wanderer.start();
  t.mock.timers.tick(wanderRest.max * 5);
  assert.equal(moves.length, 0);
  wanderer.stop();
});

test('asked to hop, Edi hops now: wandering off, mid-conversation, no rest first; a drag still stops it', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  let held = false;
  const { wanderer, moves, hops, at } = stage({
    enabled: () => false,
    idle: () => false,
    held: () => held,
  });
  wanderer.start();
  // On its own it never moves: wandering is off and Edi is busy answering.
  t.mock.timers.tick(wanderRest.max * 2);
  assert.equal(moves.length, 0);

  assert.equal(wanderer.hopNow(), true);
  for (let elapsed = 0; elapsed < 150; elapsed += 30) t.mock.timers.tick(30);
  assert.ok(at().y < 700, 'in the air at once');
  assert.deepEqual(hops, ['up 1']);
  // Asking again mid-hop does not start a second one on top.
  assert.equal(wanderer.hopNow(), true);
  for (let elapsed = 0; elapsed < 900; elapsed += 30) t.mock.timers.tick(30);
  assert.equal(wanderer.walking, false);
  assert.deepEqual([at().x, at().y], [160, 700]);

  // The person takes hold of Edi during an asked hop: it stops where it is.
  assert.equal(wanderer.hopNow(), true);
  for (let elapsed = 0; elapsed < 150; elapsed += 30) t.mock.timers.tick(30);
  held = true;
  t.mock.timers.tick(30);
  assert.equal(wanderer.walking, false);
  // And afterwards it is back to not moving on its own.
  const before = moves.length;
  held = false;
  t.mock.timers.tick(wanderRest.max * 2);
  assert.equal(moves.length, before);
  wanderer.stop();
});
