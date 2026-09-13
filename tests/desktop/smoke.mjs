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
  const expectedTop = { mochi: 17, edi: 22 }[skin];
  expect(result.box.y - 2).toBeGreaterThanOrEqual(expectedTop);
  expect(result.box.right + 2).toBeLessThanOrEqual(154);
  const expectedBottom = { mochi: 148, edi: 149 }[skin];
  expect(result.box.bottom + 2).toBeLessThanOrEqual(expectedBottom);
}
async function launch() {
  instance = await electron.launch({
    // Desktop tests must never open a real microphone.
    env: { ...process.env, EDI_VOICE: 'off', EDI_MODEL_CATALOG: 'off' },
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
  // Home is where the card opens; without an AI connection it offers setup, not a composer.
  await expect(workspace.getByRole('heading', { name: /^(Good|Still up)/ })).toBeVisible();
  await expect(workspace.getByRole('textbox', { name: 'Ask Edi' })).toHaveCount(0);
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
  // Edi is the default character.
  await expect(pet.getByRole('img', { name: /^Edi avatar/ })).toBeVisible();
  await checkGeometry(pet, 'edi');
  await workspace.getByRole('button', { name: /^Set up AI/ }).click();
  await expect(workspace.getByLabel('OpenRouter API key')).toHaveAttribute('type', 'password');
  // Without the online catalog the picker falls back to typing a model ID.
  await expect(workspace.getByLabel('OpenRouter model ID')).toBeVisible();
  await expect(workspace.getByRole('button', { name: 'Save connection' })).toBeDisabled();
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
  await workspace.getByRole('button', { name: 'Back to Settings' }).click();
  await expect(workspace.getByRole('button', { name: /^AI/ })).toContainText('Not connected');
  const petCannotChangeSettings = await pet.evaluate(async () => {
    try {
      await window.edi.command({ type: 'apply-skin', skin: 'mochi' });
      return false;
    } catch {
      return true;
    }
  });
  expect(petCannotChangeSettings).toBe(true);
  await workspace.getByRole('button', { name: /choose a section/ }).click();
  await workspace.getByRole('menuitem', { name: /Appearance/ }).click();
  // Only Edi and Mochi are offered; retired characters are gone.
  await expect(workspace.getByRole('button', { name: /avatar option/ })).toHaveCount(2);
  await workspace.getByRole('button', { name: 'Mochi avatar option' }).click();
  await workspace.getByRole('button', { name: 'Use Mochi' }).click();
  await expect(pet.getByRole('img', { name: /^Mochi avatar/ })).toBeVisible();
  await checkGeometry(pet, 'mochi');
  // Size follows a slider. The card (and the slider in it) stays still while dragging, even when
  // a display edge pushes Edi; the value is saved and the card re-attaches once, on release.
  const windowBounds = () =>
    instance.evaluate(({ BrowserWindow }) => {
      const all = BrowserWindow.getAllWindows();
      return {
        pet: all.find(w => w.webContents.getURL().includes('surface=pet')).getBounds(),
        card: all.find(w => w.webContents.getURL().includes('surface=workspace')).getBounds(),
      };
    });
  const before = await windowBounds();
  const slider = workspace.getByLabel('Size on your desktop');
  await slider.fill('1.35');
  await expect.poll(async () => (await windowBounds()).pet.width).toBe(151);
  const grown = await windowBounds();
  expect(grown.pet.height).toBe(162);
  expect(grown.card).toEqual(before.card);
  await slider.dispatchEvent('pointerup');
  await expect
    .poll(async () => (await workspace.evaluate(() => window.edi.settings())).petScale)
    .toBe(1.35);
  await slider.fill('1');
  await slider.dispatchEvent('pointerup');
  await expect.poll(async () => (await windowBounds()).pet.width).toBe(112);
  await workspace.getByRole('button', { name: 'Pin card', exact: true }).click();
  await expect(workspace.getByRole('button', { name: 'Unpin card' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await workspace.getByRole('button', { name: /choose a section/ }).click();
  await workspace.getByRole('menuitem', { name: /Library/ }).click();
  await expect(workspace.getByRole('heading', { name: 'Nothing saved yet.' })).toBeVisible();
  // Generated content opens in its own glass window beside the card, like an artifact panel:
  // title, Copy, Download, Show in Finder and Close, no Back and no Save to Library footer.
  // The artifact IPC is replaced only inside this isolated test process.
  const artifactId = '00000000-0000-4000-8000-000000000099';
  await instance.evaluate(
    ({ ipcMain }, fixture) => {
      ipcMain.removeHandler('edi:artifact:get');
      ipcMain.handle('edi:artifact:get', () => fixture.artifact);
    },
    {
      artifact: {
        kind: 'document',
        title: 'Generated report',
        markdown: '## Result\n\nLarge information lives here.\n\n---\n\nMore below.',
      },
    },
  );
  const libraryPage = await workspace.evaluate(
    () => document.querySelector('.workspace-card')?.dataset.view,
  );
  await workspace.evaluate(ref => window.edi.command({ type: 'open-artifact', ref }), {
    callId: artifactId,
  });
  await expect
    .poll(() => instance.windows().some(page => page.url().includes('surface=artifact')))
    .toBe(true);
  const artifactPage = instance.windows().find(page => page.url().includes('surface=artifact'));
  await expect(artifactPage.getByRole('heading', { name: 'Generated report' })).toBeVisible();
  await expect(artifactPage.getByText('Large information lives here.')).toBeVisible();
  await expect(artifactPage.locator('hr')).toHaveCount(1);
  await expect(artifactPage.getByRole('button', { name: 'Copy' })).toBeVisible();
  await expect(artifactPage.getByRole('button', { name: 'Download' })).toBeVisible();
  await expect(artifactPage.getByRole('button', { name: 'Close' })).toBeVisible();
  await expect(artifactPage.getByRole('button', { name: /Back/ })).toHaveCount(0);
  await expect(artifactPage.getByRole('button', { name: /Save to Library/ })).toHaveCount(0);
  // Copy uses the real system clipboard; put the person's clipboard back afterwards.
  const savedClipboard = await instance.evaluate(({ clipboard }) => clipboard.readText());
  await artifactPage.getByRole('button', { name: 'Copy' }).click();
  await expect(artifactPage.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await instance.evaluate(({ clipboard }) => clipboard.readText())).toContain(
    'Large information lives here.',
  );
  await instance.evaluate(({ clipboard }, text) => clipboard.writeText(text), savedClipboard);
  // The page underneath stays where it was; the artifact does not replace it.
  expect(
    await workspace.evaluate(() => document.querySelector('.workspace-card')?.dataset.view),
  ).toBe(libraryPage);
  // Beside the card, not on top of it.
  const [cardBox, artifactBox] = await instance.evaluate(({ BrowserWindow }) =>
    ['surface=workspace', 'surface=artifact'].map(surface =>
      BrowserWindow.getAllWindows()
        .find(win => win.webContents.getURL().includes(surface))
        .getBounds(),
    ),
  );
  expect(
    artifactBox.x >= cardBox.x + cardBox.width || artifactBox.x + artifactBox.width <= cardBox.x,
  ).toBe(true);
  await artifactPage.getByRole('button', { name: 'Close' }).click();
  await expect
    .poll(() => instance.windows().some(page => page.url().includes('surface=artifact')))
    .toBe(false);
  // Retired preview catalog entries must not come back as fake capabilities.
  await expect(workspace.getByText('Your calendar')).toHaveCount(0);
  await workspace.getByRole('button', { name: /choose a section/ }).click();
  await workspace.getByRole('menuitem', { name: /Settings/ }).click();
  await workspace.getByRole('button', { name: /^Voice/ }).click();
  await expect(workspace.getByRole('radio', { name: /Jane · Pocket/ })).toBeVisible();
  await expect(workspace.getByRole('radio', { name: /Chatterbox Turbo/ })).toBeVisible();
  const speakReplies = workspace.getByRole('switch', { name: 'Speak replies' });
  await expect(speakReplies).toHaveAttribute('aria-checked', 'true');
  await speakReplies.click();
  await expect(speakReplies).toHaveAttribute('aria-checked', 'false');
  expect((await workspace.evaluate(() => window.edi.settings())).speakReplies).toBe(false);
  await workspace.getByRole('button', { name: 'Back to Settings' }).click();
  await workspace.getByRole('button', { name: /^Privacy/ }).click();
  await workspace.getByRole('button', { name: /^Activity/ }).click();
  await expect(workspace.getByRole('heading', { name: 'A quiet beginning.' })).toBeVisible();
  await workspace.getByRole('button', { name: 'Back to Privacy & Permissions' }).click();
  // Edi's own navigation reaches nested pages through the closed destination list.
  await workspace.evaluate(() =>
    window.edi.command({ type: 'show-workspace', view: 'settings.keyboard' }),
  );
  await expect(workspace.getByText('Hold to talk')).toBeVisible();
  await workspace.getByRole('button', { name: 'Expand card' }).click();
  await expect(workspace.getByRole('button', { name: 'Collapse card' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  const sidebar = workspace.getByRole('navigation', { name: 'Edi sections' });
  await expect(sidebar.getByRole('button', { name: 'Settings' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await sidebar.getByRole('button', { name: 'Skills' }).click();
  // Built-in abilities work under the hood; Skills lists only add-ons, and there are none yet.
  await expect(workspace.getByRole('heading', { name: 'No skills yet.' })).toBeVisible();
  await expect(workspace.getByText('Edi setup guide')).toHaveCount(0);
  await workspace.screenshot({ path: 'tests/desktop/workspace-expanded.png' });
  await sidebar.getByRole('button', { name: 'Conversations' }).click();
  await expect(
    workspace.getByRole('heading', { name: 'Connect an AI model first.' }),
  ).toBeVisible();
  await sidebar.getByRole('button', { name: 'Home' }).click();
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
  // Pinned or not, a hidden card reopens beside Edi's new position.
  const petScale = Math.min(beforeDrag.pet.width / 160, beforeDrag.pet.height / 170);
  const cardAnchor = {
    x: beforeDrag.pet.x + (beforeDrag.pet.width - 160 * petScale) / 2 + 31 * petScale,
    y: beforeDrag.pet.y + (beforeDrag.pet.height - 170 * petScale) / 2 + 40 * petScale,
  };
  expect(
    Math.abs(beforeDrag.card.x + beforeDrag.card.width + 12 - cardAnchor.x),
  ).toBeLessThanOrEqual(1);
  expect(Math.abs(beforeDrag.card.y + beforeDrag.card.height - cardAnchor.y)).toBeLessThanOrEqual(
    1,
  );
  const origin = { x: beforeDrag.pet.x + 56, y: beforeDrag.pet.y + 65 };
  await drag('start', origin);
  await drag('move', { x: origin.x - 2, y: origin.y - 2 });
  expect((await bounds()).pet).toEqual(beforeDrag.pet);
  await drag('move', { x: origin.x - 80, y: origin.y - 40 }, 99);
  expect((await bounds()).pet).toEqual(beforeDrag.pet);
  const target = { x: origin.x - 80, y: origin.y - 40 };
  await drag('move', target);
  expect((await bounds()).pet.x).toBe(beforeDrag.pet.x - 80);
  // A pinned card still travels with Edi; pinning only stops it closing on focus loss.
  expect((await bounds()).card.x).toBe(beforeDrag.card.x - 80);
  expect((await bounds()).card.y).toBe(beforeDrag.card.y - 40);
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
  await expect(pet.getByRole('img', { name: /^Mochi avatar/ })).toBeVisible();
  await expect(workspace.getByRole('button', { name: 'Unpin card' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect((await workspace.evaluate(() => window.edi.settings())).speakReplies).toBe(false);
  expect(errors).toEqual([]);
  console.log(
    'PASS: hidden card at launch, two windows, avatar sync/persistence, pin and speech-setting persistence, section menu, settings pages, sidebar, expand/collapse, no renderer errors.',
  );
} finally {
  await instance?.close();
}
