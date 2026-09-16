import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const profile = await mkdtemp(join(tmpdir(), 'edi-approval-'));
const executablePath = resolve(
  'apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
);
const renderer = pathToFileURL(resolve('apps/desktop/out/renderer/index.html'));
renderer.search = new URLSearchParams({
  surface: 'voice-status',
  state: 'approval',
  side: 'right',
  skin: 'mochi',
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
      // The approval bubble's window size (factory.ts statusBubbleSize.approval, tail included).
      width: 320,
      height: 199,
      show: true,
      transparent: true,
      frame: false,
      webPreferences: { contextIsolation: false, nodeIntegration: false },
    });
    globalThis.__approvalPreview = preview;
    void preview.loadURL('about:blank');
  });
  const page = await opened;
  await page.addInitScript(() => {
    const approval = {
      callId: '00000000-0000-4000-8000-000000000010',
      runId: '00000000-0000-4000-8000-000000000001',
      capability: { id: 'notes.save', title: 'Save a note' },
      preview: {
        title: 'Save a note',
        action: 'Save Note',
        summary: 'Save this note for later.',
        fields: [
          { label: 'Title', value: 'Project direction' },
          { label: 'Location', value: '/Users/example/Documents/Edi/Notes/project-direction.md' },
        ],
        body: '# Project direction\n\nFull content remains in the card.',
      },
    };
    window.ediBubble = {
      approval: async () => approval,
      subscribeApproval: () => () => {},
      respond: async (_callId, decision) => {
        window.__approvalAction = decision;
      },
      showContent: async () => {
        window.__approvalAction = 'details';
      },
    };
  });
  await page.goto(renderer.href);

  // Notification-style: where it's from, the question and one detail line; Always allow; buttons.
  await expect(page.getByText('Notes', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Save this note for later.' })).toBeVisible();
  await expect(
    // The detail line reads from the home folder; the full path is in Details.
    page.getByText('~/Documents/Edi/Notes/project-direction.md'),
  ).toBeVisible();
  for (const name of ['Deny', 'Details'])
    await expect(page.getByRole('button', { name })).toBeVisible();
  const always = page.getByRole('checkbox', { name: 'Always allow in this chat' });
  await expect(always).not.toBeChecked();
  const approve = page.getByRole('button', { name: 'Save Note' });
  await expect(approve).toBeDisabled();
  await expect(approve).toBeEnabled({ timeout: 2_000 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight))
    .toBe(true);
  // Ticking Always allow turns the action into an approval for the rest of the chat.
  const screenshot = join(profile, 'approval-bubble.png');
  await page.screenshot({ path: screenshot, omitBackground: true });
  await always.check();
  await approve.click();
  await expect.poll(() => page.evaluate(() => window.__approvalAction)).toBe('approve-always');
  console.log(`PASS: compact approval bubble fits and responds. Screenshot: ${screenshot}`);
} finally {
  await app?.close();
}
