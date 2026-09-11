import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'edi-smoke-'));
const executablePath = process.env.EDI_TEST_EXECUTABLE || resolve('apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const args = process.env.EDI_TEST_EXECUTABLE ? [`--user-data-dir=${profile}`] : [resolve('apps/desktop'), `--user-data-dir=${profile}`];
let instance;
const errors = [];
async function launch() {
  instance = await electron.launch({ executablePath, args });
  instance.on('window', page => page.on('pageerror', error => errors.push(error.message)));
  await expect.poll(() => instance.windows().length).toBe(2);
  await expect.poll(() => instance.windows().filter(page => page.url().includes('surface=')).length).toBe(2);
  const pages = instance.windows();
  const workspace = pages.find(page => page.url().includes('surface=workspace'));
  const pet = pages.find(page => page.url().includes('surface=pet'));
  if (!workspace || !pet) throw new Error('Missing Edi windows');
  expect(await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('surface=workspace')).isVisible())).toBe(false);
  await workspace.evaluate(() => window.edi.command({ type: 'show-workspace' }));
  await expect(workspace.getByRole('heading', { name: /A little space/ })).toBeVisible();
  return { workspace, pet };
}
try {
  let { workspace, pet } = await launch();
  const petCannotChangeSettings = await pet.evaluate(async () => {
    try { await window.edi.command({ type: 'apply-skin', skin: 'sprout' }); return false; }
    catch { return true; }
  });
  expect(petCannotChangeSettings).toBe(true);
  await workspace.getByRole('button', { name: 'More options' }).click();
  await workspace.getByRole('button', { name: /Appearance/ }).click();
  await workspace.getByRole('button', { name: 'Sprout avatar option' }).click();
  await workspace.getByRole('button', { name: 'Use Sprout' }).click();
  await expect(pet.getByRole('img', { name: 'Sprout avatar' })).toBeVisible();
  await workspace.getByRole('button', { name: 'Pin card', exact: true }).click();
  await expect(workspace.getByRole('button', { name: 'Unpin card' })).toHaveAttribute('aria-pressed', 'true');
  await workspace.getByRole('button', { name: 'More options' }).click();
  await workspace.getByRole('button', { name: /Extensions/ }).click();
  await workspace.getByRole('textbox', { name: 'Search extensions' }).fill('calendar');
  await expect(workspace.getByRole('heading', { name: 'Your calendar' })).toBeVisible();
  await expect(workspace.getByRole('heading', { name: 'Meeting notes' })).toHaveCount(0);
  await workspace.getByRole('button', { name: 'Back to content' }).click();
  await workspace.getByRole('button', { name: /Preview a response/ }).click();
  await expect(workspace.getByText('Imagine', { exact: true })).toBeVisible();
  await workspace.getByRole('button', { name: 'Expand card' }).click();
  await expect(workspace.getByRole('button', { name: 'Collapse card' })).toHaveAttribute('aria-expanded', 'true');
  await workspace.getByRole('button', { name: 'Collapse card' }).click();
  await workspace.screenshot({ path: 'tests/desktop/workspace.png' });
  await instance.close();
  ({ workspace, pet } = await launch());
  await expect(pet.getByRole('img', { name: 'Sprout avatar' })).toBeVisible();
  await expect(workspace.getByRole('button', { name: 'Unpin card' })).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
  console.log('PASS: hidden card at launch, two windows, avatar sync/persistence, pin persistence, extension search, expand/collapse, no renderer errors.');
} finally { await instance?.close(); }
