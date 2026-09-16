import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeWhen, nextRunAt } from './index';

const local = (y: number, m: number, d: number, h = 0, min = 0) =>
  new Date(y, m - 1, d, h, min).getTime();

test('daily schedules run at the next matching local time, skipping days not chosen', () => {
  // Monday 14 Sep 2026, 10:00.
  const monday10 = local(2026, 9, 14, 10);
  assert.equal(nextRunAt({ kind: 'daily', time: '09:00' }, monday10), local(2026, 9, 15, 9));
  assert.equal(nextRunAt({ kind: 'daily', time: '11:30' }, monday10), local(2026, 9, 14, 11, 30));
  // Friday 18 Sep after 9:00, weekdays only: next is Monday 21 Sep.
  assert.equal(
    nextRunAt(
      { kind: 'daily', time: '09:00', days: ['mon', 'tue', 'wed', 'thu', 'fri'] },
      local(2026, 9, 18, 9, 1),
    ),
    local(2026, 9, 21, 9),
  );
  assert.equal(
    nextRunAt({ kind: 'daily', time: '09:00', days: ['sun'] }, monday10),
    local(2026, 9, 20, 9),
  );
  // Exactly at the time counts as passed, so a run never repeats in the same minute.
  assert.equal(nextRunAt({ kind: 'daily', time: '10:00' }, monday10), local(2026, 9, 15, 10));
});

test('once runs one time; every-N-hours keeps its rhythm from creation', () => {
  const now = local(2026, 9, 14, 10);
  assert.equal(nextRunAt({ kind: 'once', at: '2026-09-14T15:00' }, now), local(2026, 9, 14, 15));
  assert.equal(nextRunAt({ kind: 'once', at: '2026-09-14T09:00' }, now), null);
  const created = local(2026, 9, 14, 8, 20);
  assert.equal(
    nextRunAt({ kind: 'every', hours: 4 }, created, created),
    local(2026, 9, 14, 12, 20),
  );
  // After sleeping through two slots, the next run is the next slot, not a burst of catch-ups.
  assert.equal(
    nextRunAt({ kind: 'every', hours: 4 }, local(2026, 9, 14, 21), created),
    local(2026, 9, 15, 0, 20),
  );
});

test('schedules read naturally', () => {
  assert.equal(describeWhen({ kind: 'daily', time: '09:00' }), 'Every day at 09:00');
  assert.equal(
    describeWhen({ kind: 'daily', time: '08:30', days: ['mon', 'tue', 'wed', 'thu', 'fri'] }),
    'Every weekday at 08:30',
  );
  assert.equal(
    describeWhen({ kind: 'daily', time: '10:00', days: ['mon', 'thu'] }),
    'Every Monday, Thursday at 10:00',
  );
  assert.equal(describeWhen({ kind: 'every', hours: 1 }), 'Every hour');
  assert.equal(describeWhen({ kind: 'once', at: '2026-09-20T15:00' }), 'Once on Sep 20 at 15:00');
});
