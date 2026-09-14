import { stat } from 'node:fs/promises';
import { basename, dirname, extname } from 'node:path';
import { z } from 'zod';
import { defineCapability } from '../types';
import { displayPath, locateFile, type FileDependencies } from './files';

/**
 * Doing things on the Mac for the person: opening apps, links and files, showing a file in
 * Finder, and their Reminders and Calendar. Opening and adding always goes through review
 * (with "Always allow" for an app, a site, a folder, or adding reminders and events); showing
 * in Finder and reading reminders or events do not change anything.
 */
export type EventAccess = 'granted' | 'not-determined' | 'denied' | 'restricted' | 'write-only';

export interface ReminderItem {
  title: string;
  /** Local time in ms; null when there is no due date. */
  due: number | null;
  dueHasTime: boolean;
  notes: string;
  list: string;
  completed: boolean;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  location: string;
  calendar: string;
  notes: string;
}

/** EventKit through the native helper; absent where it is unavailable. */
export interface EventStore {
  access(entity: 'events' | 'reminders'): Promise<EventAccess>;
  /** Shows the macOS prompt when access was never asked; resolves whether it is granted. */
  request(entity: 'events' | 'reminders'): Promise<boolean>;
  listReminders(options: {
    list?: string;
    include: 'open' | 'completed' | 'all';
    limit: number;
  }): Promise<ReminderItem[]>;
  createReminders(
    items: {
      title: string;
      due: number | null;
      dueHasTime: boolean;
      notes: string;
      list?: string;
    }[],
  ): Promise<{ title: string; list: string; error?: string }[]>;
  listEvents(options: { from: number; to: number; calendar?: string }): Promise<CalendarEvent[]>;
  createEvent(event: {
    title: string;
    start: number;
    end: number;
    allDay: boolean;
    location: string;
    notes: string;
    calendar?: string;
  }): Promise<{ calendar: string }>;
  updateEvent(event: {
    eventId: string;
    title?: string;
    start?: number;
    end?: number;
    allDay?: boolean;
    location?: string;
    notes?: string;
    calendar?: string;
  }): Promise<{ calendar: string }>;
  deleteEvent(eventId: string): Promise<{ deleted: boolean }>;
}

export interface MacDependencies {
  files: FileDependencies;
  /** Installed apps whose name matches, best first. */
  findApps(name: string): Promise<{ name: string; path: string }[]>;
  openApp(path: string): Promise<void>;
  openUrl(url: string): Promise<void>;
  openFile(path: string, appPath?: string): Promise<void>;
  reveal(path: string): void;
  events?: EventStore;
  /** Local time zone name for previews, e.g. "Africa/Lagos". */
  timeZone?: string;
}

/** Opening these runs code (apps, scripts, installers, shortcuts to other things). */
const RUNNABLE =
  /^\.(app|command|tool|sh|zsh|bash|csh|fish|pkg|mpkg|terminal|workflow|action|scpt|scptd|applescript|jar|webloc|fileloc|inetloc|url|prefpane|kext|mobileconfig|shortcut|osax|plugin|saver|qlgenerator|dylib|so)$/i;

const appName = z.string().trim().min(1).max(120).describe('The app’s name, e.g. “Safari”');

/** "2026-09-15" (a day) or "2026-09-15T15:30" (local time); offsets are honoured if given. */
const localTime = z
  .string()
  .trim()
  .regex(
    /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/,
    'Use YYYY-MM-DD or YYYY-MM-DDTHH:MM (local time)',
  );

export function parseLocalTime(value: string): { at: number; hasTime: boolean } {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const at = day
    ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])).getTime()
    : new Date(value).getTime();
  if (!Number.isFinite(at)) throw new Error(`${value} is not a date Edi understands.`);
  return { at, hasTime: !day };
}

function when(at: number, hasTime: boolean) {
  return new Date(at).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...(hasTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  });
}

const siteOf = (url: URL) => url.hostname.toLowerCase().replace(/^www\./, '');

export function macCapabilities(deps: MacDependencies) {
  const home = (path: string) => displayPath(path, deps.files.home);

  async function app(name: string) {
    const [found] = await deps.findApps(name);
    if (!found) throw new Error(`No app named “${name}” is installed.`);
    return found;
  }

  const openApp = defineCapability({
    id: 'mac.open_app',
    title: 'Open an app',
    description:
      'Open (or bring forward) an app installed on this Mac by name, e.g. “Safari”, “Notes”, ' +
      '“Visual Studio Code”. The user reviews it the first time.',
    effect: 'write',
    timeoutMs: 15_000,
    input: z.object({ name: appName }).strict(),
    async prepare({ name }) {
      const found = await app(name);
      return {
        scope: { kind: 'app', value: found.path, label: found.name, covers: [found.path] },
        preview: {
          title: 'Open an app',
          action: `Open ${found.name}`.slice(0, 40),
          summary: `Open ${found.name}.`,
          fields: [],
        },
        async execute() {
          await deps.openApp(found.path);
          return { summary: `Opened ${found.name}.` };
        },
      };
    },
  });

  const openUrl = defineCapability({
    id: 'mac.open_url',
    title: 'Open a link',
    description:
      'Open a web address in the user’s default browser, for them to see or use (to read a page ' +
      'yourself, use web_fetch). Only http and https links. The user reviews it, and can always ' +
      'allow a site.',
    effect: 'write',
    timeoutMs: 15_000,
    input: z
      .object({ url: z.string().trim().min(1).max(2048).describe('The full https address') })
      .strict(),
    prepare({ url }) {
      let target: URL;
      try {
        target = new URL(url);
      } catch {
        throw new Error('That is not a web address.');
      }
      if (target.protocol !== 'https:' && target.protocol !== 'http:')
        throw new Error('Edi only opens http and https links.');
      if (target.username || target.password)
        throw new Error('Edi does not open links with a name or password in them.');
      const site = siteOf(target);
      return {
        scope: { kind: 'site', value: site, label: site, covers: [site] },
        preview: {
          title: 'Open a link',
          action: 'Open Link',
          summary: `Open ${site} in your browser.`,
          fields: [{ label: 'Address', value: target.href.slice(0, 600) }],
        },
        async execute() {
          await deps.openUrl(target.href);
          return { summary: `Opened ${site} in the browser.` };
        },
      };
    },
  });

  const openFile = defineCapability({
    id: 'mac.open_file',
    title: 'Open a file',
    description:
      'Open a file or folder the user can see in Finder with its usual app, or with a named app ' +
      '(e.g. a PDF in Preview). Never opens apps, scripts or installers. The user reviews it, and ' +
      'can always allow a folder.',
    effect: 'write',
    timeoutMs: 15_000,
    input: z
      .object({
        path: z.string().trim().min(1).max(1024).describe('A full path or one starting with ~/'),
        app: appName.optional().describe('Open with this app instead of the usual one'),
      })
      .strict(),
    async prepare({ path, app: withApp }) {
      const target = await locateFile(deps.files, path);
      const info = await stat(target.path);
      // A bundle is a folder, and a script can have no extension but still run.
      if (
        RUNNABLE.test(extname(target.path)) ||
        (info.isFile() && info.mode & 0o111 && !extname(target.path))
      )
        throw new Error('Edi doesn’t open apps, scripts, installers or shortcuts.');
      const using = withApp ? await app(withApp) : undefined;
      const name = basename(target.path);
      return {
        scope: {
          kind: 'folder',
          value: dirname(target.path),
          label: home(dirname(target.path)),
          covers: [target.path],
        },
        preview: {
          title: 'Open a file',
          action: 'Open',
          summary: `Open ${name}${using ? ` in ${using.name}` : ''}.`,
          fields: [{ label: 'File', value: home(target.path) }],
        },
        async execute() {
          await deps.openFile(target.path, using?.path);
          return { summary: `Opened ${name}${using ? ` in ${using.name}` : ''}.` };
        },
      };
    },
  });

  const reveal = defineCapability({
    id: 'mac.reveal',
    title: 'Show in Finder',
    description: 'Show a file or folder in Finder, selected, so the user can find it.',
    effect: 'read',
    timeoutMs: 10_000,
    input: z.object({ path: z.string().trim().min(1).max(1024) }).strict(),
    prepare({ path }) {
      return {
        preview: { title: 'Show in Finder', action: 'Show', summary: `Show ${path}.`, fields: [] },
        async execute() {
          const target = await locateFile(deps.files, path);
          deps.reveal(target.path);
          return { summary: `Showed ${basename(target.path)} in Finder.` };
        },
      };
    },
  });

  async function store(entity: 'events' | 'reminders') {
    const events = deps.events;
    const name = entity === 'events' ? 'Calendar' : 'Reminders';
    if (!events) throw new Error(`${name} isn’t available on this Mac.`);
    let access = await events.access(entity);
    if (access === 'not-determined') access = (await events.request(entity)) ? 'granted' : 'denied';
    if (access !== 'granted')
      throw new Error(
        `Edi doesn’t have full access to ${name}. Allow it in Settings → Privacy & Permissions.`,
      );
    return events;
  }

  const listReminders = defineCapability({
    id: 'reminders.list',
    title: 'Check reminders',
    description:
      'List the user’s reminders from the Reminders app: open ones by default, or completed or all, ' +
      'optionally from one list. Returns titles, due dates, notes and lists.',
    effect: 'read',
    timeoutMs: 20_000,
    input: z
      .object({
        list: z.string().trim().min(1).max(120).optional().describe('Only this list'),
        include: z.enum(['open', 'completed', 'all']).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      })
      .strict(),
    prepare({ list, include = 'open', limit = 50 }) {
      return {
        preview: {
          title: 'Check reminders',
          action: 'Check',
          summary: 'Check reminders.',
          fields: [],
        },
        async execute() {
          const items = await (await store('reminders')).listReminders({ list, include, limit });
          return {
            summary: items.length === 1 ? 'Found 1 reminder.' : `Found ${items.length} reminders.`,
            output: {
              reminders: items.map(item => ({
                title: item.title,
                due: item.due === null ? null : when(item.due, item.dueHasTime),
                list: item.list,
                ...(item.notes ? { notes: item.notes.slice(0, 500) } : {}),
                ...(item.completed ? { completed: true } : {}),
              })),
            },
          };
        },
      };
    },
  });

  const createReminders = defineCapability({
    id: 'reminders.create',
    title: 'Add reminders',
    description:
      'Add reminders to the Reminders app, all in ONE call (up to 20). A due time also alerts the ' +
      'user then. Dates are local: YYYY-MM-DD for a day, YYYY-MM-DDTHH:MM for a time. The user ' +
      'reviews the list once.',
    effect: 'write',
    timeoutMs: 20_000,
    input: z
      .object({
        reminders: z
          .array(
            z
              .object({
                title: z.string().trim().min(1).max(300),
                due: localTime.optional(),
                notes: z.string().max(2000).optional(),
                list: z.string().trim().min(1).max(120).optional(),
              })
              .strict(),
          )
          .min(1)
          .max(20),
      })
      .strict(),
    prepare({ reminders }) {
      const items = reminders.map(item => {
        const due = item.due ? parseLocalTime(item.due) : null;
        return {
          title: item.title,
          due: due?.at ?? null,
          dueHasTime: due?.hasTime ?? false,
          notes: item.notes ?? '',
          ...(item.list ? { list: item.list } : {}),
        };
      });
      const line = (item: (typeof items)[number]) =>
        `${item.title}${item.due === null ? '' : ` — ${when(item.due, item.dueHasTime)}`}${item.list ? ` (${item.list})` : ''}`;
      return {
        scope: { kind: 'any', value: '', label: 'Reminders', covers: [] },
        preview: {
          title: items.length === 1 ? 'Add a reminder' : 'Add reminders',
          action: items.length === 1 ? 'Add Reminder' : 'Add Reminders',
          summary:
            items.length === 1 ? `Add “${line(items[0]!)}”.` : `Add ${items.length} reminders.`,
          fields: [],
          ...(items.length > 1 ? { body: items.map(line).join('\n') } : {}),
        },
        async execute() {
          const results = await (await store('reminders')).createReminders(items);
          const failed = results.filter(result => result.error);
          const added = results.length - failed.length;
          return {
            summary:
              `Added ${added === 1 ? '1 reminder' : `${added} reminders`}` +
              (failed.length
                ? `; ${failed.length} didn’t work (${failed.map(result => result.title).join(', ')}).`
                : '.'),
            output: { results },
          };
        },
      };
    },
  });

  const listEvents = defineCapability({
    id: 'calendar.events',
    title: 'Check the calendar',
    description:
      'List events in the user’s calendars between two local dates or times (up to 62 days), ' +
      'optionally in one calendar.',
    effect: 'read',
    timeoutMs: 20_000,
    input: z
      .object({
        from: localTime,
        to: localTime,
        calendar: z.string().trim().min(1).max(120).optional(),
      })
      .strict(),
    prepare({ from, to, calendar }) {
      const start = parseLocalTime(from).at;
      const endAt = parseLocalTime(to);
      // A day given as the end means through the end of that day.
      const end = endAt.hasTime ? endAt.at : endAt.at + 24 * 60 * 60 * 1000;
      if (end <= start) throw new Error('The end must be after the start.');
      if (end - start > 62 * 24 * 60 * 60 * 1000)
        throw new Error('Look at 62 days or fewer at a time.');
      return {
        preview: {
          title: 'Check the calendar',
          action: 'Check',
          summary: 'Check events.',
          fields: [],
        },
        async execute() {
          const events = await (
            await store('events')
          ).listEvents({ from: start, to: end, calendar });
          return {
            summary: events.length === 1 ? 'Found 1 event.' : `Found ${events.length} events.`,
            output: {
              events: events.map(event => ({
                id: event.id,
                title: event.title,
                start: when(event.start, !event.allDay),
                end: when(event.end, !event.allDay),
                ...(event.allDay ? { allDay: true } : {}),
                calendar: event.calendar,
                ...(event.location ? { location: event.location } : {}),
                ...(event.notes ? { notes: event.notes.slice(0, 500) } : {}),
              })),
              ...(deps.timeZone ? { timeZone: deps.timeZone } : {}),
            },
          };
        },
      };
    },
  });

  const createEvent = defineCapability({
    id: 'calendar.create',
    title: 'Add an event',
    description:
      'Add one event to the user’s calendar. Local times as YYYY-MM-DDTHH:MM, or days as ' +
      'YYYY-MM-DD with allDay. Uses their default calendar unless one is named. The user reviews it.',
    effect: 'write',
    timeoutMs: 20_000,
    input: z
      .object({
        title: z.string().trim().min(1).max(300),
        start: localTime,
        end: localTime.optional().describe('Defaults to one hour after the start'),
        allDay: z.boolean().optional(),
        location: z.string().max(300).optional(),
        notes: z.string().max(2000).optional(),
        calendar: z.string().trim().min(1).max(120).optional(),
      })
      .strict(),
    prepare(input) {
      const start = parseLocalTime(input.start);
      const allDay = input.allDay ?? !start.hasTime;
      const end = input.end
        ? parseLocalTime(input.end).at
        : start.at + (allDay ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000);
      if (end <= start.at) throw new Error('The event must end after it starts.');
      const event = {
        title: input.title,
        start: start.at,
        end,
        allDay,
        location: input.location ?? '',
        notes: input.notes ?? '',
        ...(input.calendar ? { calendar: input.calendar } : {}),
      };
      return {
        scope: { kind: 'any', value: '', label: 'Calendar', covers: [] },
        preview: {
          title: 'Add an event',
          action: 'Add Event',
          summary: `Add “${input.title}” on ${when(start.at, !allDay)}.`,
          fields: [
            {
              label: 'When',
              value: allDay
                ? when(start.at, false)
                : `${when(start.at, true)} – ${new Date(end).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`,
            },
            ...(input.location ? [{ label: 'Where', value: input.location }] : []),
            ...(input.calendar ? [{ label: 'Calendar', value: input.calendar }] : []),
          ],
          ...(input.notes ? { body: input.notes } : {}),
        },
        async execute() {
          const saved = await (await store('events')).createEvent(event);
          return { summary: `Added “${input.title}” to ${saved.calendar}.` };
        },
      };
    },
  });

  const updateEvent = defineCapability({
    id: 'calendar.update',
    title: 'Update an event',
    description:
      'Update an existing calendar event by its id (from calendar_events). Only the fields provided ' +
      'are changed; omitted fields stay as they are. The user reviews the change.',
    effect: 'write',
    timeoutMs: 20_000,
    input: z
      .object({
        eventId: z.string().min(1).max(200),
        title: z.string().trim().min(1).max(300).optional(),
        start: localTime.optional(),
        end: localTime.optional(),
        allDay: z.boolean().optional(),
        location: z.string().max(300).optional(),
        notes: z.string().max(2000).optional(),
        calendar: z.string().trim().min(1).max(120).optional(),
      })
      .strict(),
    prepare(input) {
      const fields: { label: string; value: string }[] = [];
      if (input.title) fields.push({ label: 'Title', value: input.title });
      if (input.start) fields.push({ label: 'Start', value: input.start });
      if (input.end) fields.push({ label: 'End', value: input.end });
      if (input.location) fields.push({ label: 'Where', value: input.location });
      if (input.calendar) fields.push({ label: 'Calendar', value: input.calendar });
      return {
        scope: { kind: 'any', value: '', label: 'Calendar', covers: [] },
        preview: {
          title: 'Update an event',
          action: 'Update Event',
          summary: `Update "${input.title || 'event'}".`,
          fields,
          ...(input.notes ? { body: input.notes } : {}),
        },
        async execute() {
          const patch: Parameters<EventStore['updateEvent']>[0] = { eventId: input.eventId };
          if (input.title) patch.title = input.title;
          if (input.start) patch.start = parseLocalTime(input.start).at;
          if (input.end) patch.end = parseLocalTime(input.end).at;
          if (input.allDay !== undefined) patch.allDay = input.allDay;
          if (input.location !== undefined) patch.location = input.location;
          if (input.notes !== undefined) patch.notes = input.notes;
          if (input.calendar) patch.calendar = input.calendar;
          const saved = await (await store('events')).updateEvent(patch);
          return { summary: `Updated event in ${saved.calendar}.` };
        },
      };
    },
  });

  const deleteEvent = defineCapability({
    id: 'calendar.delete',
    title: 'Delete an event',
    description:
      'Delete an existing calendar event by its id (from calendar_events). The user reviews before ' +
      'it is removed.',
    effect: 'write',
    timeoutMs: 20_000,
    input: z
      .object({
        eventId: z.string().min(1).max(200),
        title: z.string().max(300).optional().describe('Shown in the review for clarity'),
      })
      .strict(),
    prepare(input) {
      return {
        scope: { kind: 'any', value: '', label: 'Calendar', covers: [] },
        preview: {
          title: 'Delete an event',
          action: 'Delete Event',
          summary: `Delete "${input.title || 'event'}".`,
          fields: [],
        },
        async execute() {
          await (await store('events')).deleteEvent(input.eventId);
          return { summary: `Deleted "${input.title || 'the event'}".` };
        },
      };
    },
  });

  return [
    openApp,
    openUrl,
    openFile,
    reveal,
    listReminders,
    createReminders,
    listEvents,
    createEvent,
    updateEvent,
    deleteEvent,
  ] as const;
}
