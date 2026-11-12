import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// The reply bubble: Edi's answer in words beside the character, with a field to answer back.
const profile = await mkdtemp(join(tmpdir(), 'edi-reply-'));
const executablePath = resolve(
  'apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
);
const renderer = pathToFileURL(resolve('apps/desktop/out/renderer/index.html'));
renderer.search = new URLSearchParams({
  surface: 'voice-status',
  state: 'reply',
  side: 'right',
  skin: 'edi',
  name: 'Edi',
}).toString();

let app;
try {
  app = await electron.launch({
    env: { ...process.env, EDI_VOICE: 'off' },
    executablePath,
    args: [resolve('apps/desktop'), `--user-data-dir=${profile}`],
  });
  await expect
    .poll(() => app.windows().filter(page => page.url().includes('surface=')).length)
    .toBe(2);

  const opened = new Promise(resolvePage => app.once('window', resolvePage));
  await app.evaluate(({ BrowserWindow }) => {
    const preview = new BrowserWindow({
      // A four-line answer with a progress line (factory.ts replyBubbleSize, tail included).
      width: 320,
      height: 177,
      show: true,
      transparent: true,
      frame: false,
      webPreferences: { contextIsolation: false, nodeIntegration: false },
    });
    globalThis.__replyPreview = preview;
    void preview.loadURL('about:blank');
  });
  const page = await opened;
  await page.addInitScript(() => {
    window.__sent = [];
    window.ediBubble = {
      approval: async () => null,
      subscribeApproval: () => () => {},
      reply: async () => ({
        text: 'Your next meeting is **Design review** at 2:30pm with Sam and Priya. You have 40 minutes free before it, and the notes are in [the brief](https://example.com/brief).',
        progress: 'Checking your calendar',
        done: false,
      }),
      subscribeReply: callback => {
        window.__pushReply = callback;
        return () => {};
      },
      ask: async prompt => {
        window.__sent.push(prompt);
      },
      hold: async () => {
        window.__held = true;
      },
      openLink: async url => {
        window.__link = url;
      },
      showContent: async () => {
        window.__opened = true;
      },
    };
  });
  await page.goto(renderer.href);

  // The answer is there in words, with what Edi is doing under it.
  await expect(page.getByText('Design review')).toBeVisible();
  await expect(page.getByText('Checking your calendar')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight))
    .toBe(true);
  const writing = join(profile, 'reply-bubble-writing.png');
  await page.screenshot({ path: writing, omitBackground: true });

  // A link opens through the bubble's own narrow bridge.
  await page.getByRole('link', { name: 'the brief' }).click();
  await expect.poll(() => page.evaluate(() => window.__link)).toBe('https://example.com/brief');

  // Finished: the progress line goes; Open shows the whole conversation.
  await page.evaluate(() =>
    window.__pushReply({
      text: 'Your next meeting is Design review at 2:30pm.',
      progress: '',
      done: true,
    }),
  );
  await expect(page.getByText('Checking your calendar')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open' }).click();
  await expect.poll(() => page.evaluate(() => window.__opened)).toBe(true);

  // Typing holds the bubble open and sends the next question without the card.
  const field = page.getByRole('textbox', { name: 'Reply to Edi' });
  await field.fill('Move it to 3pm');
  await expect.poll(() => page.evaluate(() => window.__held)).toBe(true);
  const done = join(profile, 'reply-bubble-typing.png');
  await page.screenshot({ path: done, omitBackground: true });
  await field.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__sent)).toEqual(['Move it to 3pm']);
  await expect(field).toHaveValue('');
  console.log(
    `PASS: reply bubble shows the answer and sends a reply. Screenshots: ${writing} ${done}`,
  );
} finally {
  await app?.close();
}
