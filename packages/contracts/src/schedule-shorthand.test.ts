import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeScheduleWhen, scheduleWhenSchema } from './index';

const read = (raw: unknown) => scheduleWhenSchema.safeParse(normalizeScheduleWhen(raw));

test('shorthand timings a model writes are read the way they were meant', () => {
  for (const [raw, expected] of [
    ['09:00', { kind: 'daily', time: '09:00' }],
    ['9:30', { kind: 'daily', time: '09:30' }],
    [{ time: '8:05' }, { kind: 'daily', time: '08:05' }],
    [
      { daily: { time: '09:00', days: ['Monday', 'Tue', 'wednesday'] } },
      { kind: 'daily', time: '09:00', days: ['mon', 'tue', 'wed'] },
    ],
    [{ at: '2026-09-16T15:00' }, { kind: 'once', at: '2026-09-16T15:00' }],
    ['2026-09-16T15:00', { kind: 'once', at: '2026-09-16T15:00' }],
    [{ hours: 4 }, { kind: 'every', hours: 4 }],
    ['{"kind":"every","hours":2}', { kind: 'every', hours: 2 }],
    [{ kind: 'daily', time: '7:00' }, { kind: 'daily', time: '07:00' }],
  ] as const) {
    const parsed = read(raw);
    assert.ok(parsed.success, JSON.stringify(raw));
    assert.deepEqual(parsed.data, expected, JSON.stringify(raw));
  }
});

test('anything ambiguous is left for the schema to explain, never guessed', () => {
  for (const raw of ['every morning', 'daily at 9am', { time: '25:00' }, { days: ['mon'] }, 42])
    assert.equal(read(raw).success, false, JSON.stringify(raw));
  // A well-formed value passes through untouched.
  const once = { kind: 'once', at: '2026-01-02T03:04' };
  assert.deepEqual(normalizeScheduleWhen(once), once);
});
