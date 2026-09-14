import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { macCapabilities, parseLocalTime, type EventStore } from './index';

const context = {
  callId: '00000000-0000-4000-8000-000000000001',
  runId: '00000000-0000-4000-8000-000000000002',
};
const live = () => new AbortController().signal;

async function harness(access: 'granted' | 'not-determined' | 'denied' = 'granted') {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'edi-mac-')));
  await mkdir(join(base, 'Documents/Tools'), { recursive: true });
  await writeFile(join(base, 'Documents/report.pdf'), '%PDF');
  await writeFile(join(base, 'Documents/Tools/install.command'), 'rm -rf ~');
  await writeFile(join(base, 'Documents/Tools/run'), '#!/bin/sh');
  await chmod(join(base, 'Documents/Tools/run'), 0o755);
  const opened: string[] = [];
  const saved: unknown[] = [];
  let state = access;
  const events: EventStore = {
    access: async () => state,
    request: async () => {
      opened.push('prompt');
      state = 'granted';
      return true;
    },
    listReminders: async () => [
      {
        title: 'Pay rent',
        due: parseLocalTime('2026-09-30').at,
        dueHasTime: false,
        notes: '',
        list: 'Home',
        completed: false,
      },
    ],
    createReminders: async items => {
      saved.push(...items);
      return items.map(item => ({ title: item.title, list: item.list ?? 'Reminders' }));
    },
    listEvents: async () => [],
    createEvent: async event => {
      saved.push(event);
      return { calendar: 'Work' };
    },
    updateEvent: async event => {
      saved.push(event);
      return { calendar: 'Work' };
    },
    deleteEvent: async eventId => {
      saved.push({ deleted: eventId });
      return { deleted: true };
    },
  };
  const tools = macCapabilities({
    files: {
      home: base,
      roots: () => [{ name: 'Documents', path: join(base, 'Documents'), access: 'allowed' }],
      workspace: join(base, 'Documents/Edi'),
      trash: async () => {},
    },
    findApps: async name =>
      /preview/i.test(name) ? [{ name: 'Preview', path: '/System/Applications/Preview.app' }] : [],
    openApp: async path => void opened.push(`app:${path}`),
    openUrl: async url => void opened.push(`url:${url}`),
    openFile: async (path, app) => void opened.push(`file:${path}${app ? `@${app}` : ''}`),
    reveal: path => void opened.push(`reveal:${path}`),
    events,
  });
  const tool = (id: string) => tools.find(entry => entry.id === id)!;
  const prepare = async (id: string, input: unknown) => tool(id).prepare(input as never, context);
  return { base, opened, saved, prepare };
}

test('links open only over http(s), and “Always allow” applies to the site', async () => {
  const { opened, prepare } = await harness();
  const link = await prepare('mac.open_url', { url: 'https://www.github.com/anthropics' });
  assert.deepEqual(link.scope, {
    kind: 'site',
    value: 'github.com',
    label: 'github.com',
    covers: ['github.com'],
  });
  await link.execute(live());
  assert.deepEqual(opened, ['url:https://www.github.com/anthropics']);
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'https://ada:secret@example.com'])
    await assert.rejects(prepare('mac.open_url', { url }), /only opens|name or password/);
});

test('files open inside allowed folders, never programs; apps must be installed', async () => {
  const { base, opened, prepare } = await harness();
  const file = await prepare('mac.open_file', { path: '~/Documents/report.pdf', app: 'Preview' });
  assert.equal(file.preview.summary, 'Open report.pdf in Preview.');
  assert.equal(file.scope?.kind, 'folder');
  assert.equal(file.scope?.value, join(base, 'Documents'));
  await file.execute(live());
  assert.deepEqual(opened, [
    `file:${join(base, 'Documents/report.pdf')}@/System/Applications/Preview.app`,
  ]);
  for (const path of ['~/Documents/Tools/install.command', '~/Documents/Tools/run'])
    await assert.rejects(prepare('mac.open_file', { path }), /doesn’t open apps/);
  await assert.rejects(prepare('mac.open_file', { path: '/etc/hosts' }), /outside the folders/);
  await assert.rejects(prepare('mac.open_app', { name: 'Nonexistent' }), /No app named/);
});

test('reminders use local days and times, ask macOS once, and are allowed as a kind', async () => {
  const { opened, saved, prepare } = await harness('not-determined');
  const add = await prepare('reminders.create', {
    reminders: [
      { title: 'Call Mum', due: '2026-09-15T18:30' },
      { title: 'Pay rent', due: '2026-09-30', list: 'Home' },
    ],
  });
  assert.equal(add.scope?.kind, 'any');
  assert.match(
    add.preview.body ?? '',
    /Call Mum — Tue, Sep 15, 2026, 6:30 PM\nPay rent — Wed, Sep 30, 2026 \(Home\)/,
  );
  const result = await add.execute(live());
  assert.equal(result.summary, 'Added 2 reminders.');
  assert.deepEqual(opened, ['prompt']);
  assert.deepEqual(saved[0], {
    title: 'Call Mum',
    due: new Date(2026, 8, 15, 18, 30).getTime(),
    dueHasTime: true,
    notes: '',
  });
  assert.equal((saved[1] as { due: number }).due, new Date(2026, 8, 30).getTime());
  await assert.rejects(
    prepare('reminders.create', { reminders: [{ title: 'x', due: 'next tuesday' }] }),
    /not a date/,
  );
});

test('calendar: a day range reads through its last day; access that is off points to Settings', async () => {
  const denied = await harness('denied');
  const look = await denied.prepare('calendar.events', { from: '2026-09-14', to: '2026-09-14' });
  await assert.rejects(look.execute(live()), /Settings → Privacy/);
  await assert.rejects(
    denied.prepare('calendar.events', { from: '2026-09-01', to: '2026-12-31' }),
    /62 days/,
  );
  const { saved, prepare } = await harness();
  const event = await prepare('calendar.create', { title: 'Standup', start: '2026-09-15T09:00' });
  assert.deepEqual(event.preview.fields[0], {
    label: 'When',
    value: 'Tue, Sep 15, 2026, 9:00 AM – 10:00 AM',
  });
  assert.equal((await event.execute(live())).summary, 'Added “Standup” to Work.');
  assert.equal(
    (saved[0] as { end: number }).end - (saved[0] as { start: number }).start,
    3_600_000,
  );
});
