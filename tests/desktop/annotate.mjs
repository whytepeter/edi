import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/*
 * The person's own marks: a drag over the annotation overlay draws ink and reports the box it
 * covers, so Edi's screenshot shows what they circled. Nothing here moves their pointer.
 * Do not run while `pnpm dev` Edi is open: both share a bundle id and the test app is killed.
 */
const profile = await mkdtemp(join(tmpdir(), 'edi-annotate-'));
const renderer = pathToFileURL(resolve('apps/desktop/out/renderer/index.html'));
renderer.search = new URLSearchParams({ surface: 'annotate', accent: '#e0533d' }).toString();

let app;
try {
  app = await electron.launch({
    env: { ...process.env, EDI_VOICE: 'off', EDI_MODEL_CATALOG: 'off' },
    executablePath: resolve(
      'apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
    ),
    args: [resolve('apps/desktop'), `--user-data-dir=${profile}`],
  });
  await expect
    .poll(() => app.windows().filter(page => page.url().includes('surface=')).length)
    .toBe(2);

  const opened = new Promise(resolvePage => app.once('window', resolvePage));
  await app.evaluate(({ BrowserWindow }) => {
    const overlay = new BrowserWindow({
      width: 900,
      height: 600,
      show: true,
      transparent: true,
      frame: false,
      webPreferences: { contextIsolation: false, nodeIntegration: false },
    });
    globalThis.__annotatePreview = overlay;
    void overlay.loadURL('about:blank');
  });
  const page = await opened;
  await page.addInitScript(() => {
    window.__commands = [];
    window.edi = {
      command: async command => void window.__commands.push(command),
      onNavigate: () => () => {},
    };
  });
  await page.goto(renderer.href);
  await expect(page.locator('svg.annotate-surface')).toBeVisible();

  // A drag draws a stroke and reports the box it covers, in the overlay's own pixels.
  await page.mouse.move(200, 150);
  await page.mouse.down();
  for (const [x, y] of [
    [260, 160],
    [320, 220],
    [380, 300],
  ]) {
    await page.mouse.move(x, y, { steps: 4 });
  }
  await page.mouse.up();
  await expect(page.locator('.annotate-ink')).toHaveCount(2); // the ink and its second pass
  const drawn = await page.evaluate(() => window.__commands.at(-1));
  expect(drawn.type).toBe('annotation-drawn');
  expect(drawn.x).toBeGreaterThanOrEqual(195);
  expect(drawn.y).toBeGreaterThanOrEqual(145);
  expect(drawn.width).toBeGreaterThan(100);
  expect(drawn.height).toBeGreaterThan(100);

  // A click with no movement is not a mark.
  const before = await page.evaluate(() => window.__commands.length);
  await page.mouse.click(600, 400);
  expect(await page.evaluate(() => window.__commands.length)).toBe(before);

  const screenshot = join(profile, 'annotation.png');
  await page.screenshot({ path: screenshot, omitBackground: true });
  console.log(`PASS: a drag marks the screen and reports its box. Screenshot: ${screenshot}`);
} finally {
  await app?.close();
}
