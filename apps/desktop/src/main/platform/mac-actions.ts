import { execFile } from 'node:child_process';
import { basename, join } from 'node:path';
import { shell } from 'electron';
import type {
  CalendarEvent,
  EventAccess,
  EventStore,
  FileDependencies,
  MacDependencies,
  ReminderItem,
} from '@edi/capabilities';
import { eventKit } from '../permissions';

const run = (file: string, args: string[], timeout = 8_000) =>
  new Promise<string>((resolve, reject) =>
    execFile(file, args, { timeout, maxBuffer: 1024 * 1024 }, (error, stdout) =>
      error ? reject(error) : resolve(stdout),
    ),
  );

/** Installed apps (Applications folders only) whose name contains `name`, exact names first. */
export async function findApps(name: string, home: string) {
  const words = name
    .toLowerCase()
    .replace(/\.app$/, '')
    .trim();
  if (!words || /["*\\]/.test(words)) return [];
  const folders = ['/Applications', '/System/Applications', join(home, 'Applications')];
  const found = await run('/usr/bin/mdfind', [
    ...folders.flatMap(folder => ['-onlyin', folder]),
    `kMDItemContentType == "com.apple.application-bundle" && kMDItemFSName == "*${words}*"cd`,
  ]).catch(() => '');
  const apps = found
    .split('\n')
    .filter(path => path.endsWith('.app'))
    .map(path => ({ name: basename(path, '.app'), path }));
  const score = (app: { name: string; path: string }) => {
    const lower = app.name.toLowerCase();
    return (
      (lower === words ? 0 : lower.startsWith(words) ? 1 : 2) * 10 +
      // Apps inside other apps (helpers) are rarely what someone means.
      (app.path.slice(0, -4).includes('.app/') ? 5 : 0) +
      app.path.split('/').length / 100
    );
  };
  return apps.sort((a, b) => score(a) - score(b)).slice(0, 5);
}

const accessNames: Record<number, EventAccess> = {
  0: 'not-determined',
  1: 'restricted',
  2: 'denied',
  3: 'granted',
  4: 'write-only',
};

/** Reminders and Calendar through the native helper, or undefined when it isn't available. */
export function createEventStore(): EventStore | undefined {
  const kit = eventKit();
  if (!kit) return undefined;
  const entity = (name: 'events' | 'reminders') => (name === 'events' ? 0 : 1);
  return {
    access: async name => accessNames[kit.status(entity(name))] ?? 'denied',
    request: name => kit.request(entity(name)),
    listReminders: async options =>
      (await kit.run({ op: 'reminders.list', ...options })) as ReminderItem[],
    createReminders: async items =>
      (await kit.run({ op: 'reminders.create', items })) as {
        title: string;
        list: string;
        error?: string;
      }[],
    listEvents: async options =>
      (await kit.run({ op: 'events.list', ...options })) as CalendarEvent[],
    createEvent: async event =>
      (await kit.run({ op: 'events.create', ...event })) as { calendar: string },
    updateEvent: async event =>
      (await kit.run({ op: 'events.update', ...event })) as { calendar: string },
    deleteEvent: async eventId =>
      (await kit.run({ op: 'events.delete', eventId })) as { deleted: boolean },
  };
}

export function macDependencies(files: FileDependencies): MacDependencies {
  const events = process.platform === 'darwin' ? createEventStore() : undefined;
  return {
    files,
    findApps: name => findApps(name, files.home),
    openApp: async path => {
      await run('/usr/bin/open', ['-a', path]);
    },
    openUrl: url => shell.openExternal(url, { activate: true }),
    openFile: async (path, appPath) => {
      if (appPath) {
        await run('/usr/bin/open', ['-a', appPath, path]);
        return;
      }
      const error = await shell.openPath(path);
      if (error) throw new Error(error);
    },
    reveal: path => shell.showItemInFolder(path),
    ...(events ? { events } : {}),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}
