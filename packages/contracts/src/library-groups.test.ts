import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupLibraryByDate, libraryWhenFor, type LibraryPlaceable } from './library-groups';

/** 2026-09-16, 14:00 local. Every case below is built by walking back from it. */
const now = new Date(2026, 8, 16, 14, 0, 0).getTime();
const at = (
  year: number,
  month: number,
  day: number,
  hour = 12,
): LibraryPlaceable & { id: string } => ({
  id: `${year}-${month}-${day}-${hour}`,
  createdAt: new Date(year, month, day, hour).getTime(),
  pinned: false,
});
const titles = (groups: { title: string }[]) => groups.map(group => group.title);

test('pinned comes first, then calendar buckets newest to oldest', () => {
  const groups = groupLibraryByDate(
    [
      at(2026, 8, 16), // today
      at(2026, 8, 15), // yesterday
      at(2026, 8, 12), // 4 days back
      at(2026, 8, 1), // 15 days back
      at(2026, 6, 4), // July
      { ...at(2026, 7, 9), pinned: true },
    ],
    now,
  );
  assert.deepEqual(titles(groups), [
    'Pinned',
    'Today',
    'Yesterday',
    'Previous 7 Days',
    'Previous 30 Days',
    'July',
  ]);
});

test('empty buckets never appear', () => {
  const groups = groupLibraryByDate([at(2026, 8, 16), at(2026, 6, 4)], now);
  assert.deepEqual(titles(groups), ['Today', 'July']);
});

test('with nothing pinned there is no Pinned heading', () => {
  assert.deepEqual(titles(groupLibraryByDate([at(2026, 8, 16)], now)), ['Today']);
});

test('a pinned item is not repeated in its date bucket', () => {
  const groups = groupLibraryByDate([{ ...at(2026, 8, 16), pinned: true }], now);
  assert.deepEqual(titles(groups), ['Pinned']);
  assert.equal(groups.length, 1, 'Today would be empty, so it is left out');
});

test('buckets are calendar days, not 24-hour windows', () => {
  // 11pm last night is "Yesterday" even though it is under 24 hours ago at 14:00 today... and
  // 1am today is "Today" even though it is further back in the day.
  const lateLastNight = at(2026, 8, 15, 23);
  const earlyToday = at(2026, 8, 16, 1);
  const groups = groupLibraryByDate([lateLastNight, earlyToday], now);
  assert.deepEqual(titles(groups), ['Today', 'Yesterday']);
  assert.deepEqual(
    groups.map(group => group.items.map(item => item.id)),
    [[earlyToday.id], [lateLastNight.id]],
  );
});

test('each bucket says how its rows should tell the time', () => {
  const groups = groupLibraryByDate([at(2026, 8, 16), at(2026, 8, 12), at(2026, 6, 4)], now);
  assert.deepEqual(
    groups.map(group => group.when),
    ['time', 'weekday', 'date'],
  );
});

test('a month in another year keeps its year; this year stays quiet', () => {
  const groups = groupLibraryByDate([at(2026, 1, 3), at(2025, 10, 20)], now);
  assert.deepEqual(titles(groups), ['February', 'November 2025']);
});

test('the same month in different years does not collide', () => {
  const groups = groupLibraryByDate([at(2026, 1, 3), at(2025, 1, 3)], now);
  assert.deepEqual(titles(groups), ['February', 'February 2025']);
  assert.equal(new Set(groups.map(group => group.key)).size, 2);
});

test('items inside a group run newest first, whatever order they arrive in', () => {
  const older = at(2026, 8, 16, 9);
  const newer = at(2026, 8, 16, 13);
  const groups = groupLibraryByDate([older, newer], now);
  assert.deepEqual(
    groups[0]!.items.map(item => item.id),
    [newer.id, older.id],
  );
});

test('nothing saved means nothing to group', () => {
  assert.deepEqual(groupLibraryByDate([], now), []);
});

test('the list it is given is not reordered in place', () => {
  const items = [at(2026, 6, 4), at(2026, 8, 16)];
  const before = items.map(item => item.id);
  groupLibraryByDate(items, now);
  assert.deepEqual(
    items.map(item => item.id),
    before,
  );
});

test('pinned rows each say when in their own terms', () => {
  const groups = groupLibraryByDate([{ ...at(2026, 6, 4), pinned: true }], now);
  assert.equal(groups[0]!.when, 'mixed');
  assert.equal(libraryWhenFor(new Date(2026, 8, 16, 9).getTime(), now), 'time');
  assert.equal(libraryWhenFor(new Date(2026, 8, 15, 9).getTime(), now), 'time');
  assert.equal(libraryWhenFor(new Date(2026, 8, 12).getTime(), now), 'weekday');
  assert.equal(libraryWhenFor(new Date(2026, 6, 4).getTime(), now), 'date');
});
