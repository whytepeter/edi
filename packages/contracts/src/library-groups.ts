/**
 * How the Library stacks up on screen. The Library is a stream of things Edi just made, so it
 * reads in calendar order: what you pinned, then today, yesterday, and back through the months.
 *
 * Buckets are calendar days in the reader's own timezone, not 24-hour windows: something saved at
 * 11pm last night is "Yesterday" at 1am, the way a person would say it.
 */

/** How a row says when it was made; the view does the locale formatting. */
export type LibraryWhen =
  /** Inside today or yesterday, the clock is what tells them apart: "2:14 PM". */
  | 'time'
  /** Within the last week, the day carries it: "Monday". */
  | 'weekday'
  /** Older than that, the date: "Sep 3". */
  | 'date';

/**
 * A date group's rows all sit in one stretch of time, so they can share one way of saying when.
 * Pinned rows come from anywhere, so each works its own out with `libraryWhenFor`.
 */
export type GroupWhen = LibraryWhen | 'mixed';

export interface LibraryGroup<Item> {
  /** Stable across reloads, for React keys. */
  key: string;
  title: string;
  when: GroupWhen;
  items: Item[];
}

/** The least a thing needs for the Library to place it. */
export interface LibraryPlaceable {
  createdAt: number;
  pinned: boolean;
}

/** Midnight at the start of the day `time` falls in, in the running machine's timezone. */
function startOfDay(time: number): number {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

const DAY = 24 * 60 * 60 * 1000;

/** Whole days between the calendar day `createdAt` fell in and the one `now` falls in. */
function daysBack(createdAt: number, now: number): number {
  return Math.floor((startOfDay(now) - startOfDay(createdAt)) / DAY);
}

/**
 * How one row should say when it was made, wherever it sits. Used for pinned rows, which are
 * grouped by the pin rather than by the date.
 */
export function libraryWhenFor(createdAt: number, now: number): LibraryWhen {
  const days = daysBack(createdAt, now);
  if (days <= 1) return 'time';
  if (days < 7) return 'weekday';
  return 'date';
}

/**
 * Which bucket a moment belongs to, as a sort key and a title. Months keep their year only when
 * it isn't the current one, so a recent Library stays quiet: "August", not "August 2026".
 */
function bucketFor(
  createdAt: number,
  now: number,
): { key: string; title: string; when: LibraryWhen } {
  const days = daysBack(createdAt, now);

  if (days <= 0) return { key: 'today', title: 'Today', when: 'time' };
  if (days === 1) return { key: 'yesterday', title: 'Yesterday', when: 'time' };
  if (days < 7) return { key: 'week', title: 'Previous 7 Days', when: 'weekday' };
  if (days < 30) return { key: 'month', title: 'Previous 30 Days', when: 'date' };

  const date = new Date(createdAt);
  const year = date.getFullYear();
  const month = date.toLocaleDateString(undefined, { month: 'long' });
  return {
    key: `m-${year}-${date.getMonth()}`,
    title: year === new Date(now).getFullYear() ? month : `${month} ${year}`,
    when: 'date',
  };
}

/**
 * Pinned first, then newest to oldest by calendar bucket. Empty buckets never appear, so a Library
 * with three items in it shows one or two headings rather than a column of empty ones.
 *
 * A pinned item appears only under Pinned: repeating it below would make the list lie about how
 * much is in the folder.
 */
export function groupLibraryByDate<Item extends LibraryPlaceable>(
  items: readonly Item[],
  now: number,
): LibraryGroup<Item>[] {
  const newestFirst = [...items].sort((a, b) => b.createdAt - a.createdAt);

  const pinned = newestFirst.filter(item => item.pinned);
  const groups: LibraryGroup<Item>[] = pinned.length
    ? [{ key: 'pinned', title: 'Pinned', when: 'mixed', items: pinned }]
    : [];

  // Insertion order is newest-first already, so the map's own order is the order on screen.
  const byBucket = new Map<string, LibraryGroup<Item>>();
  for (const item of newestFirst) {
    if (item.pinned) continue;
    const bucket = bucketFor(item.createdAt, now);
    const group = byBucket.get(bucket.key);
    if (group) group.items.push(item);
    else byBucket.set(bucket.key, { ...bucket, items: [item] });
  }

  return [...groups, ...byBucket.values()];
}
