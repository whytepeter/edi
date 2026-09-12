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
  skin: 'sprout',
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
      width: 340,
      height: 220,
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
      preview: {
        title: 'Save a note',
        action: 'Save Note',
        summary: 'Edi wants to save this note for later.',
        fields: [
          { label: 'Title', value: 'Project direction' },
          { label: 'Location', value: '/Users/example/Documents/Edi Notes/project-direction.md' },
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

  await expect(page.getByRole('heading', { name: 'Save a note' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'View details' })).toBeVisible();
  const approve = page.getByRole('button', { name: 'Save Note' });
  await expect(approve).toBeDisabled();
  await expect(approve).toBeEnabled({ timeout: 2_000 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight))
    .toBe(true);
  await approve.click();
  await expect.poll(() => page.evaluate(() => window.__approvalAction)).toBe('approve');
  const screenshot = join(profile, 'approval-bubble.png');
  await page.screenshot({ path: screenshot, omitBackground: true });
  console.log(`PASS: compact approval bubble fits and responds. Screenshot: ${screenshot}`);
} finally {
  await app?.close();
}
