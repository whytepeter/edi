import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'edi-character-animation-'));
const screenshotDirectory = process.env.EDI_SHOT_DIR;
if (screenshotDirectory) await mkdir(screenshotDirectory, { recursive: true });
const executablePath =
  process.env.EDI_TEST_EXECUTABLE ||
  resolve('apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const args = process.env.EDI_TEST_EXECUTABLE
  ? [`--user-data-dir=${profile}`]
  : [resolve('apps/desktop'), `--user-data-dir=${profile}`];

let instance;
try {
  instance = await electron.launch({
    env: { ...process.env, EDI_VOICE: 'off' },
    executablePath,
    args,
  });
  await expect.poll(() => instance.windows().length).toBe(2);
  const workspace = instance.windows().find(page => page.url().includes('surface=workspace'));
  const pet = instance.windows().find(page => page.url().includes('surface=pet'));
  if (!workspace || !pet) throw new Error('Missing Edi windows');

  const show = expression =>
    instance.evaluate(({ BrowserWindow }, nextExpression) => {
      const target = BrowserWindow.getAllWindows().find(window =>
        window.webContents.getURL().includes('surface=pet'),
      );
      target.webContents.send('edi:character-expression', nextExpression);
    }, expression);

  const states = [
    ['idle', '.pet-body', 'edi-idle'],
    // The bubble shows listening and thinking; the character only changes its eyes.
    ['listening', '.pet-body', 'edi-idle'],
    ['thinking', '.pet-body', 'edi-idle'],
    ['speaking', '.pet-mouth-talk', 'edi-mouth'],
    ['happy', '.pet-body', 'edi-happy'],
    ['attention', '.pet-attention', 'edi-attention-mark'],
  ];

  for (const skin of ['edi', 'mochi']) {
    await workspace.evaluate(
      nextSkin => window.edi.command({ type: 'apply-skin', skin: nextSkin }),
      skin,
    );
    await expect(pet.locator('.pet-art')).toHaveAttribute('data-skin', skin);
    for (const [expression, stateSelector, stateAnimation] of states) {
      // Edi waves instead of showing attention marks.
      const [selector, animation] =
        skin === 'edi' && expression === 'attention'
          ? ['.pet-hand-right', 'edi-wave']
          : [stateSelector, stateAnimation];
      await show(expression);
      await expect(pet.locator('.pet-art')).toHaveAttribute('data-expression', expression);
      await expect
        .poll(() => pet.locator(selector).evaluate(node => getComputedStyle(node).animationName))
        .toContain(animation);
      if (expression === 'listening' || expression === 'thinking')
        await expect
          .poll(() =>
            pet
              .locator('.pet-pupils')
              .first()
              .evaluate(node => getComputedStyle(node).transform),
          )
          .not.toBe('none');
      if (skin === 'edi') {
        // Edi's small hands appear only for gestures.
        const shown = expression === 'attention' || expression === 'happy';
        await expect(pet.locator('[data-part="right-hand"]')).toHaveCSS(
          'visibility',
          shown ? 'visible' : 'hidden',
        );
        await expect(pet.locator('[data-part="left-hand"]')).toHaveCSS('visibility', 'hidden');
      }
      if (expression === 'speaking')
        for (const hand of ['.pet-hand-left', '.pet-hand-right'])
          await expect(pet.locator(hand)).toHaveCSS('animation-name', 'none');
      if (expression === 'speaking')
        await expect
          .poll(() =>
            pet.locator('.pet-mouth-talk').evaluate(node => getComputedStyle(node).opacity),
          )
          .toBe('1');
      if (expression === 'happy')
        await expect
          .poll(() =>
            pet.locator('.pet-mouth-happy').evaluate(node => getComputedStyle(node).opacity),
          )
          .toBe('1');
      if (screenshotDirectory)
        await pet.screenshot({ path: join(screenshotDirectory, `${skin}-${expression}.png`) });
    }
  }

  // No thought dots or listening rings on the character itself.
  await expect(pet.locator('.pet-thought, .pet-listening-rings')).toHaveCount(0);

  // With live speech levels the mouth follows loudness instead of the fallback rhythm.
  await show('speaking');
  const mouthScale = level =>
    pet.evaluate(value => {
      document.documentElement.dataset.lipSync = '';
      document.documentElement.style.setProperty('--edi-mouth', String(value));
      const mouth = document.querySelector('.pet-mouth-talk');
      mouth.style.transition = 'none';
      return new DOMMatrix(getComputedStyle(mouth).transform).d;
    }, level);
  expect(await mouthScale(0)).toBeCloseTo(0.16, 2);
  expect(await mouthScale(1)).toBeCloseTo(1, 2);
  await expect(pet.locator('.pet-mouth-talk')).toHaveCSS('animation-name', 'none');
  await pet.evaluate(() => {
    delete document.documentElement.dataset.lipSync;
    document.querySelector('.pet-mouth-talk').style.transition = '';
  });
  await show('attention');
  await expect(pet.locator('.pet-art')).toHaveAttribute('data-expression', 'attention');

  // Provider-specific or otherwise unknown states die at the preload boundary.
  await show('elevenlabs-excited');
  await expect(pet.locator('.pet-art')).toHaveAttribute('data-expression', 'attention');

  await workspace.evaluate(() =>
    window.edi.command({ type: 'show-workspace', view: 'appearance' }),
  );
  await expect(workspace.getByRole('button', { name: 'Edi avatar option' })).toBeVisible();
  if (screenshotDirectory)
    await workspace.screenshot({ path: join(screenshotDirectory, 'appearance.png') });

  // Reduced motion preserves the semantic face without moving it.
  await pet.emulateMedia({ reducedMotion: 'reduce' });
  await show('speaking');
  await expect(pet.locator('.pet-mouth-talk')).toHaveCSS('opacity', '1');
  await expect(pet.locator('.pet-mouth-talk')).toHaveCSS('animation-name', 'none');
  await expect(pet.locator('.pet-body')).toHaveCSS('animation-name', 'none');

  console.log(
    'PASS: all bundled skins render six semantic states with reduced-motion safety; Edi captures saved.',
  );
} finally {
  await instance?.close();
}
