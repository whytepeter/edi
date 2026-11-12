import test from 'node:test';
import assert from 'node:assert/strict';
import {
  maxTiltDegrees,
  pokeReaction,
  pokeRunMs,
  tiltFor,
  type CharacterExpression,
  type CharacterMood,
} from '../../packages/contracts/src/index';
import { PetPokes } from '../../apps/desktop/src/main/character/pet-pokes';

test('a poke does nothing at first, then Edi gets surprised, annoyed and rattled', () => {
  assert.equal(pokeReaction(1), null);
  assert.equal(pokeReaction(2), null);
  assert.equal(pokeReaction(3)?.mood, 'surprised');
  assert.equal(pokeReaction(5)?.mood, 'annoyed');
  assert.equal(pokeReaction(8)?.mood, 'confused');
  assert.equal(pokeReaction(40)?.mood, 'confused');
});

test('Edi leans against the way it is dragged, never past its limit', () => {
  assert.ok(tiltFor(400) < 0);
  assert.ok(tiltFor(-400) > 0);
  assert.equal(tiltFor(1e9), -maxTiltDegrees);
  assert.equal(tiltFor(-1e9), maxTiltDegrees);
  assert.equal(tiltFor(0), 0);
  assert.equal(tiltFor(Number.NaN), 0);
  assert.ok(Object.is(tiltFor(0), 0));
});

function harness(start: { expression?: CharacterExpression; mood?: CharacterMood } = {}) {
  let now = 1_000_000;
  const state = {
    expression: start.expression ?? ('idle' as CharacterExpression),
    mood: start.mood ?? ('neutral' as CharacterMood),
  };
  const log: string[] = [];
  const pokes = new PetPokes(
    () => state.expression,
    {
      get current() {
        return state.mood;
      },
      set: (mood, holdMs) => {
        state.mood = mood;
        log.push(`${mood}:${holdMs}`);
      },
      noteActivity: () => {
        log.push('activity');
        if (state.mood === 'sleepy') state.mood = 'neutral';
      },
    },
    () => now,
  );
  return {
    state,
    log,
    pokes,
    wait: (ms: number) => {
      now += ms;
    },
    reactions: () => log.filter(entry => entry !== 'activity'),
  };
}

test('pokes in a run escalate through Edi’s own reactions', () => {
  const t = harness();
  for (let i = 0; i < 8; i++) {
    t.pokes.poke();
    t.wait(300);
  }
  // Poke 3 surprises, 4 repeats it, 5 to 7 are annoyed, 8 is rattled.
  assert.deepEqual(
    t.reactions().map(entry => entry.split(':')[0]),
    ['surprised', 'surprised', 'annoyed', 'annoyed', 'annoyed', 'confused'],
  );
});

test('a pause starts the count over, so slow pokes never escalate', () => {
  const t = harness();
  for (let i = 0; i < 6; i++) {
    t.pokes.poke();
    t.wait(pokeRunMs + 100);
  }
  assert.deepEqual(t.reactions(), []);
});

test('Edi keeps its face while it is busy, and over a reply or error mood', () => {
  for (const expression of ['listening', 'thinking', 'speaking'] as const) {
    const t = harness({ expression });
    for (let i = 0; i < 6; i++) t.pokes.poke();
    assert.deepEqual(t.reactions(), [], expression);
  }
  const sad = harness({ mood: 'sad' });
  for (let i = 0; i < 6; i++) sad.pokes.poke();
  assert.deepEqual(sad.reactions(), []);
  assert.equal(sad.state.mood, 'sad');
});

test('even while busy, a poke still counts as interaction', () => {
  const t = harness({ expression: 'thinking' });
  t.pokes.poke();
  assert.deepEqual(t.log, ['activity']);
});

test('a poke wakes a sleepy Edi with a startle', () => {
  const t = harness({ mood: 'sleepy' });
  t.pokes.poke();
  assert.equal(t.state.mood, 'surprised');
  assert.deepEqual(t.reactions(), ['surprised:1100']);
});
