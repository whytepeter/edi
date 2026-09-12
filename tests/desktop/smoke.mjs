import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'edi-smoke-'));
const executablePath =
  process.env.EDI_TEST_EXECUTABLE ||
  resolve('apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const args = process.env.EDI_TEST_EXECUTABLE
  ? [`--user-data-dir=${profile}`]
  : [resolve('apps/desktop'), `--user-data-dir=${profile}`];
let instance;
const errors = [];
async function checkGeometry(pet, skin) {
  const result = await pet.evaluate(() => {
    const svg = document.querySelector('.pet-art');
    const group = svg.querySelector('.pet-body');
    const box = group.getBBox();
    const point = (x, y) => new DOMPoint(x, y).matrixTransform(svg.getScreenCTM());
    const hits = (x, y) => {
      const p = point(x, y);
      return document.elementFromPoint(p.x, p.y)?.closest('.pet-body') !== null;
    };
    return {
      box: { x: box.x, y: box.y, right: box.x + box.width, bottom: box.y + box.height },
      bodyHit: hits(80, 90),
      marginHit: hits(3, 3),
      shadowHit: hits(80, 153),
      left: svg.querySelector('[data-part="left-hand"]').getAttribute('transform'),
      right: svg.querySelector('[data-part="right-hand"]').getAttribute('transform'),
    };
  });
  expect(result.bodyHit).toBe(true);
  expect(result.marginHit).toBe(false);
  expect(result.shadowHit).toBe(false);
  expect(result.left).toBe('translate(30 99)');
  expect(result.right).toBe('translate(132 112)');
  expect(result.box.x - 2).toBeGreaterThanOrEqual(8);
  expect(result.box.y - 2).toBeGreaterThanOrEqual(skin === 'sprout' ? 10 : 38);
  expect(result.box.right + 2).toBeLessThanOrEqual(154);
  expect(result.box.bottom + 2).toBeLessThanOrEqual(146);
}
async function launch() {
  instance = await electron.launch({
    // Desktop tests must never open a real microphone.
    env: { ...process.env, EDI_VOICE: 'off' },
    executablePath,
    args,
  });
  instance.on('window', page => page.on('pageerror', error => errors.push(error.message)));
  await expect.poll(() => instance.windows().length).toBe(2);
  await expect
    .poll(() => instance.windows().filter(page => page.url().includes('surface=')).length)
    .toBe(2);
  const pages = instance.windows();
  const workspace = pages.find(page => page.url().includes('surface=workspace'));
  const pet = pages.find(page => page.url().includes('surface=pet'));
  if (!workspace || !pet) throw new Error('Missing Edi windows');
  const cardVisible = () =>
    instance.evaluate(({ BrowserWindow }) =>
      Boolean(
        BrowserWindow.getAllWindows()
          .find(w => w.webContents.getURL().includes('surface=workspace'))
          ?.isVisible(),
      ),
    );
  // Permissions are requested by the feature that needs them, never at launch.
  await expect.poll(cardVisible).toBe(false);
  await workspace.evaluate(() => window.edi.command({ type: 'show-workspace' }));
  await expect(workspace.getByRole('heading', { name: /A little space/ })).toBeVisible();
  await expect(workspace.getByRole('heading', { name: /Let Edi (?:see|hear)/ })).toHaveCount(0);
  return { workspace, pet };
}
try {
  let { workspace, pet } = await launch();
  const placement = await instance.evaluate(({ BrowserWindow, screen }) => {
    const windows = BrowserWindow.getAllWindows();
    const pet = windows.find(w => w.webContents.getURL().includes('surface=pet')).getBounds();
    const card = windows
      .find(w => w.webContents.getURL().includes('surface=workspace'))
      .getBounds();
    return { pet, card, area: screen.getDisplayMatching(pet).workArea };
  });
  expect(placement.pet.width).toBe(112);
  expect(placement.pet.height).toBe(120);
  const scale = Math.min(placement.pet.width / 160, placement.pet.height / 170);
  const anchorX = placement.pet.x + (placement.pet.width - 160 * scale) / 2 + 31 * scale;
  const anchorY = placement.pet.y + (placement.pet.height - 170 * scale) / 2 + 40 * scale;
  expect(Math.abs(placement.card.x + placement.card.width + 12 - anchorX)).toBeLessThanOrEqual(1);
  expect(Math.abs(placement.card.y + placement.card.height - anchorY)).toBeLessThanOrEqual(1);
  expect(placement.card.x).toBeGreaterThanOrEqual(placement.area.x);
  expect(placement.card.y).toBeGreaterThanOrEqual(placement.area.y);
  await checkGeometry(pet, 'cloud');
  await workspace.getByRole('button', { name: /Talk to Edi/ }).click();
  await expect(workspace.getByLabel('OpenRouter API key')).toHaveAttribute('type', 'password');
  await expect(workspace.getByLabel('OpenRouter model ID')).toBeVisible();
  const noCredentials = await workspace.evaluate(async () => {
    const state = await window.edi.agent();
    try {
      await window.edi.command({ type: 'ask-agent', prompt: 'Should not send' });
      return false;
    } catch {
      return !state.configured && !('apiKey' in state);
    }
  });
  expect(noCredentials).toBe(true);
  await workspace.getByRole('button', { name: 'Back to content' }).click();
  const petCannotChangeSettings = await pet.evaluate(async () => {
    try {
      await window.edi.command({ type: 'apply-skin', skin: 'sprout' });
      return false;
    } catch {
      return true;
    }
  });
  expect(petCannotChangeSettings).toBe(true);
  await workspace.getByRole('button', { name: 'More options' }).click();
  await workspace.getByRole('menuitem', { name: /Appearance/ }).click();
  await workspace.getByRole('button', { name: 'Sprout avatar option' }).click();
  await workspace.getByRole('button', { name: 'Use Sprout' }).click();
  await expect(pet.getByRole('img', { name: 'Sprout avatar' })).toBeVisible();
  await checkGeometry(pet, 'sprout');
  await workspace.getByRole('button', { name: 'Pin card', exact: true }).click();
  await expect(workspace.getByRole('button', { name: 'Unpin card' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await workspace.getByRole('button', { name: 'More options' }).click();
  await workspace.getByRole('menuitem', { name: /Extensions/ }).click();
  await workspace.getByRole('searchbox', { name: 'Search extensions' }).fill('calendar');
  await expect(workspace.getByRole('heading', { name: 'Your calendar' })).toBeVisible();
  await expect(workspace.getByRole('heading', { name: 'Meeting notes' })).toHaveCount(0);
  await workspace.getByRole('button', { name: 'Back to content' }).click();
  await expect(workspace.getByRole('button', { name: /Preview a response/ })).toHaveCount(0);
  await expect(workspace.getByRole('button', { name: 'Illustration', exact: true })).toHaveCount(0);
  await workspace.getByRole('button', { name: 'Expand card' }).click();
  await expect(workspace.getByRole('button', { name: 'Collapse card' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await workspace.getByRole('button', { name: 'Collapse card' }).click();
  await expect
    .poll(() => workspace.evaluate(() => document.documentElement.scrollHeight <= innerHeight))
    .toBe(true);
  await workspace.screenshot({ path: 'tests/desktop/workspace.png' });
  const bounds = () =>
    instance.evaluate(({ BrowserWindow }) => {
      const all = BrowserWindow.getAllWindows();
      return {
        pet: all.find(w => w.webContents.getURL().includes('surface=pet')).getBounds(),
        card: all.find(w => w.webContents.getURL().includes('surface=workspace')).getBounds(),
      };
    });
  const drag = (phase, point, pointerId = 1) =>
    pet.evaluate(command => window.edi.command(command), {
      type: 'pet-drag',
      phase,
      point,
      pointerId,
    });
  await workspace.evaluate(() => window.edi.command({ type: 'hide-workspace' }));
  const beforePointer = await bounds();
  await pet.mouse.move(56, 65);
  await pet.mouse.down();
  await pet.mouse.move(26, 45);
  await expect.poll(async () => (await bounds()).pet.x).toBe(beforePointer.pet.x - 30);
  await pet.mouse.up();
  expect(
    await instance.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find(w => w.webContents.getURL().includes('surface=workspace'))
        .isVisible(),
    ),
  ).toBe(false);
  await workspace.evaluate(() => window.edi.command({ type: 'show-workspace' }));
  const beforeDrag = await bounds();
  const origin = { x: beforeDrag.pet.x + 56, y: beforeDrag.pet.y + 65 };
  await drag('start', origin);
  await drag('move', { x: origin.x - 2, y: origin.y - 2 });
  expect((await bounds()).pet).toEqual(beforeDrag.pet);
  await drag('move', { x: origin.x - 80, y: origin.y - 40 }, 99);
  expect((await bounds()).pet).toEqual(beforeDrag.pet);
  const target = { x: origin.x - 80, y: origin.y - 40 };
  await drag('move', target);
  expect((await bounds()).pet.x).toBe(beforeDrag.pet.x - 80);
  expect((await bounds()).card).toEqual(beforeDrag.card);
  await drag('cancel', target);
  expect((await bounds()).pet).toEqual(beforeDrag.pet);
  await workspace.getByRole('button', { name: 'Unpin card' }).click();
  const beforeUnpinned = await bounds();
  await drag('start', origin);
  await drag('end', target);
  const afterDrag = await bounds();
  expect(afterDrag.pet.x).toBe(beforeDrag.pet.x - 80);
  expect(afterDrag.card.x).not.toBe(beforeUnpinned.card.x);
  expect((await workspace.evaluate(() => window.edi.settings())).petPosition).toEqual({
    x: afterDrag.pet.x,
    y: afterDrag.pet.y,
  });
  await workspace.getByRole('button', { name: 'Pin card', exact: true }).click();
  const cardCannotDragPet = await workspace.evaluate(
    async command => {
      try {
        await window.edi.command(command);
        return false;
      } catch {
        return true;
      }
    },
    { type: 'pet-drag', phase: 'start', pointerId: 2, point: target },
  );
  expect(cardCannotDragPet).toBe(true);
  await instance.close();
  ({ workspace, pet } = await launch());
  expect((await bounds()).pet).toEqual(afterDrag.pet);
  await expect(pet.getByRole('img', { name: 'Sprout avatar' })).toBeVisible();
  await expect(workspace.getByRole('button', { name: 'Unpin card' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(errors).toEqual([]);
  console.log(
    'PASS: hidden card at launch, two windows, avatar sync/persistence, pin persistence, extension search, expand/collapse, no renderer errors.',
  );
} finally {
  await instance?.close();
}
