import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'edi-character-'));
let app;
try {
  app = await electron.launch({
    // Desktop tests must never open a real microphone.
    env: { ...process.env, EDI_VOICE: 'off' },
    executablePath: resolve(
      'apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
    ),
    args: [resolve('apps/desktop'), `--user-data-dir=${profile}`],
  });
  await expect
    .poll(() => app.windows().filter(page => page.url().includes('surface=')).length)
    .toBe(2);
  const pet = app.windows().find(page => page.url().includes('surface=pet'));
  const workspace = app.windows().find(page => page.url().includes('surface=workspace'));
  await workspace.evaluate(() => window.edi.command({ type: 'hide-workspace' }));
  const visible = surface =>
    app.evaluate(
      ({ BrowserWindow }, surface) =>
        BrowserWindow.getAllWindows()
          .find(win => win.webContents.getURL().includes(`surface=${surface}`))
          ?.isVisible(),
      surface,
    );
  const action = label =>
    app.evaluate(({ Menu }, label) => {
      const item = Menu.getApplicationMenu().items[0].submenu.items.find(
        item => item.label === label,
      );
      if (!item) throw new Error(`Missing action: ${label}`);
      item.click();
    }, label);
  await expect(pet.getByRole('button', { name: 'Edi', exact: true })).toBeAttached();
  // A plain click on the character no longer starts listening.
  const petBody = await pet.locator('.pet-hit').boundingBox();
  await pet.mouse.click(petBody.x + petBody.width / 2, petBody.y + petBody.height / 2);
  await pet.waitForTimeout(600);
  expect(app.windows().some(page => page.url().includes('surface=voice-status'))).toBe(false);
  await action('Listen');
  await expect
    .poll(() => app.windows().some(page => page.url().includes('surface=voice-status')))
    .toBe(true);
  const bubble = app.windows().find(page => page.url().includes('surface=voice-status'));
  await expect(bubble.getByText('voice coming soon')).toBeVisible();
  await expect(bubble.locator('.listening-bars')).toHaveCount(0);
  expect(await visible('workspace')).toBe(false);
  await bubble.screenshot({ path: join(profile, 'voice-unavailable.png') });
  await action('Open Edi');
  await expect.poll(() => visible('workspace')).toBe(true);
  await action('Sleep Edi');
  expect(await visible('pet')).toBe(false);
  expect(await visible('workspace')).toBe(false);
  // The temporary ⌘⇧E shortcut is gone; ⌥ Space is the only global shortcut.
  expect(
    await app.evaluate(({ globalShortcut }) =>
      globalShortcut.isRegistered('CommandOrControl+Shift+E'),
    ),
  ).toBe(false);
  await action('Listen');
  await expect.poll(() => visible('pet')).toBe(true);
  expect(await visible('workspace')).toBe(false);
  const rejected = await workspace.evaluate(async () => {
    try {
      await window.edi.command({ type: 'request-listening' });
      return false;
    } catch {
      return true;
    }
  });
  expect(rejected).toBe(true);
  await action('Stop');
  await expect
    .poll(() => app.windows().filter(page => page.url().includes('voice-status')).length)
    .toBe(0);
  await pet.evaluate(() => window.edi.command({ type: 'character-menu' }));
  await expect
    .poll(() => app.windows().some(page => page.url().includes('surface=character-menu')))
    .toBe(true);
  const menu = app.windows().find(page => page.url().includes('surface=character-menu'));
  await expect(menu.getByRole('menuitem', { name: 'Open Edi' })).toBeFocused();
  await menu.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Settings' })).toBeFocused();
  // Listening and Stop are not character-menu actions.
  await expect(menu.getByRole('menuitem', { name: /Conversation|Stop/ })).toHaveCount(0);
  expect(
    await menu.evaluate(
      () => document.querySelector('.character-menu').getBoundingClientRect().bottom <= innerHeight,
    ),
  ).toBe(true);
  await menu.screenshot({ path: join(profile, 'character-menu.png') });
  await menu.keyboard.press('Escape').catch(error => {
    if (!menu.isClosed()) throw error;
  });
  await expect
    .poll(() => app.windows().some(page => page.url().includes('surface=character-menu')))
    .toBe(false);
  // Hold the real pointer on the painted body; release must not create a second bubble.
  const body = pet.locator('.pet-hit');
  const box = await body.boundingBox();
  await pet.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await pet.mouse.down();
  await expect
    .poll(() => app.windows().some(page => page.url().includes('surface=voice-status')))
    .toBe(true);
  await pet.mouse.up();
  await expect
    .poll(() => app.windows().some(page => page.url().includes('surface=voice-status')))
    .toBe(false);
  expect(await visible('workspace')).toBe(false);
  // Voice audio crosses the context bridge as typed arrays in both directions.
  await pet.evaluate(() => {
    window.__pcm = new Promise(resolve => {
      const off = window.edi.onVoice(event => {
        if (event.type !== 'pcm') return;
        off();
        resolve({ typed: event.samples instanceof Float32Array, length: event.samples.length });
      });
    });
  });
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(w =>
      w.webContents.getURL().includes('surface=pet'),
    );
    win.webContents.send('edi:voice', {
      type: 'pcm',
      generation: 999,
      turn: 1,
      rate: 24000,
      samples: new Float32Array(2400),
    });
  });
  expect(await pet.evaluate(() => window.__pcm)).toEqual({ typed: true, length: 2400 });
  // Microphone audio goes the other way as bytes; an idle session ignores it without error.
  const accepted = await pet.evaluate(() =>
    window.edi.command({ type: 'voice-pcm', generation: 0, pcm: new Uint8Array(3200) }).then(
      () => true,
      () => false,
    ),
  );
  expect(accepted).toBe(true);
  console.log(
    `Character interactions passed. Screenshot: ${join(profile, 'voice-unavailable.png')}`,
  );
} finally {
  await app?.close();
}
