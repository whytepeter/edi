import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'edi-screen-'));
const executablePath = resolve(
  'apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
);
let app;
const errors = [];
try {
  const { ELECTRON_RUN_AS_NODE: _ignored, ...launchEnv } = process.env;
  app = await electron.launch({
    env: { ...launchEnv, EDI_VOICE: 'off' },
    executablePath,
    args: [resolve('apps/desktop'), `--user-data-dir=${profile}`],
  });
  app.on('window', page => page.on('pageerror', error => errors.push(error.message)));
  await expect
    .poll(() => app.windows().filter(page => page.url().includes('surface=workspace')).length)
    .toBe(1);
  const workspace = app.windows().find(page => page.url().includes('surface=workspace'));
  if (!workspace) throw new Error('Missing workspace');
  const cardVisible = () =>
    app.evaluate(({ BrowserWindow }) =>
      Boolean(
        BrowserWindow.getAllWindows()
          .find(win => win.webContents.getURL().includes('surface=workspace'))
          ?.isVisible(),
      ),
    );
  await expect.poll(cardVisible).toBe(false);
  const permissions = await workspace.evaluate(() => window.edi.permissions());
  expect(permissions.active).toBeNull();
  expect(permissions.permissions.map(item => item.id).sort()).toEqual([
    'accessibility',
    'microphone',
    'screen-recording',
  ]);
  await workspace.evaluate(() => window.edi.command({ type: 'show-workspace' }));
  await expect(workspace.getByRole('heading', { name: /A little space/ })).toBeVisible();
  await expect(workspace.getByRole('heading', { name: /Let Edi (?:see|hear)/ })).toHaveCount(0);
  expect(errors).toEqual([]);
  console.log(
    'PASS: launch stays quiet; both permissions are registered but neither is requested.',
  );
} finally {
  await app?.close();
}
