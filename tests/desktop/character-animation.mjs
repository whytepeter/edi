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

  const send = (channel, value) =>
    instance.evaluate(
      ({ BrowserWindow }, [nextChannel, nextValue]) => {
        const target = BrowserWindow.getAllWindows().find(window =>
          window.webContents.getURL().includes('surface=pet'),
        );
        target.webContents.send(nextChannel, nextValue);
      },
      [channel, value],
    );
  const show = expression => send('edi:character-expression', expression);
  const feel = mood => send('edi:character-mood', mood);
  const activeVariant = part =>
    pet
      .locator(`[data-part="${part}"] > [data-active]`)
      .first()
      .evaluate(node => node.getAttribute('data-variant'));
  const animationOf = selector =>
    pet
      .locator(selector)
      .first()
      .evaluate(node => getComputedStyle(node).animationName);

  const states = [
    ['idle', '.pet-body', 'edi-idle'],
    // The bubble shows listening and thinking; the character only changes its eyes.
    ['listening', '.pet-body', 'edi-idle'],
    ['thinking', '.pet-body', 'edi-idle'],
    ['speaking', '[data-part="mouth"] > [data-active]', 'edi-mouth'],
    ['happy', '.pet-body', 'edi-happy'],
    // Every character waves for attention.
    ['attention', '.pet-hand-right', 'edi-wave'],
  ];

  for (const skin of ['edi', 'mochi']) {
    await workspace.evaluate(
      nextSkin => window.edi.command({ type: 'apply-skin', skin: nextSkin }),
      skin,
    );
    await expect(pet.locator('.pet-art')).toHaveAttribute('data-skin', skin);
    await feel('neutral');
    for (const [expression, selector, animation] of states) {
      await show(expression);
      await expect(pet.locator('.pet-art')).toHaveAttribute('data-expression', expression);
      await expect.poll(() => animationOf(selector)).toContain(animation);
      if (expression === 'listening' || expression === 'thinking')
        await expect
          .poll(() =>
            pet
              .locator('[data-part="pupils"]')
              .first()
              .evaluate(node => getComputedStyle(node).transform),
          )
          .not.toBe('none');
      // Small hands appear only for gestures.
      const shown = expression === 'attention' || expression === 'happy';
      await expect(pet.locator('[data-hand="right"]')).toHaveCSS(
        'visibility',
        shown ? 'visible' : 'hidden',
      );
      await expect(pet.locator('[data-hand="left"]')).toHaveCSS('visibility', 'hidden');
      if (expression === 'speaking') {
        expect(await activeVariant('mouth')).toBe('talk');
        for (const hand of ['.pet-hand-left', '.pet-hand-right'])
          await expect(pet.locator(hand)).toHaveCSS('animation-name', 'none');
      }
      if (expression === 'happy') {
        expect(await activeVariant('mouth')).toBe('happy');
        expect(await activeVariant('eyes')).toBe('happy');
      }
      // Exactly one variant of each part shows.
      for (const part of ['eyes', 'mouth'])
        await expect(pet.locator(`[data-part="${part}"] > [data-variant]:visible`)).toHaveCount(1);
      if (screenshotDirectory)
        await pet.screenshot({ path: join(screenshotDirectory, `${skin}-${expression}.png`) });
    }

    // Moods change the face and the motion; speaking keeps the talking mouth but the mood's eyes.
    await show('idle');
    const moods = [
      ['sad', 'mood-droop'],
      ['surprised', 'mood-pop'],
      ['confused', 'mood-tilt'],
      ['sleepy', 'mood-sleepy'],
      ['love', 'mood-love'],
      ['annoyed', 'mood-huff'],
      ['happy', 'mood-bouncy'],
    ];
    for (const [mood, animation] of moods) {
      await feel(mood);
      await expect(pet.locator('.pet-art')).toHaveAttribute('data-mood', mood);
      await expect.poll(() => animationOf('.pet-body')).toContain(animation);
      await expect.poll(() => activeVariant('eyes')).toBe(mood);
      if (screenshotDirectory)
        await pet.screenshot({ path: join(screenshotDirectory, `${skin}-mood-${mood}.png`) });
    }
    // Floating effects come with some moods.
    await feel('love');
    await expect(pet.locator('.pet-effects')).toHaveCount(1);
    await feel('neutral');
    await expect(pet.locator('.pet-effects')).toHaveCount(0);
    await feel('sad');
    await show('speaking');
    await expect.poll(() => activeVariant('mouth')).toBe('talk');
    await expect.poll(() => activeVariant('eyes')).toBe('sad');
    await feel('neutral');
    // Unknown moods die at the preload boundary.
    await feel('furious');
    await expect(pet.locator('.pet-art')).toHaveAttribute('data-mood', 'neutral');
  }

  // No thought dots or listening rings on the character itself.
  await expect(pet.locator('.pet-thought, .pet-listening-rings')).toHaveCount(0);

  // With live speech levels the mouth follows loudness instead of the fallback rhythm.
  await show('speaking');
  const mouthScale = level =>
    pet.evaluate(value => {
      document.documentElement.dataset.lipSync = '';
      document.documentElement.style.setProperty('--edi-mouth', String(value));
      const mouth = document.querySelector('[data-part="mouth"] > [data-active]');
      mouth.style.transition = 'none';
      return new DOMMatrix(getComputedStyle(mouth).transform).d;
    }, level);
  expect(await mouthScale(0)).toBeCloseTo(0.16, 2);
  expect(await mouthScale(1)).toBeCloseTo(1, 2);
  await expect(pet.locator('[data-part="mouth"] > [data-active]')).toHaveCSS(
    'animation-name',
    'none',
  );
  await pet.evaluate(() => {
    delete document.documentElement.dataset.lipSync;
    document.querySelector('[data-part="mouth"] > [data-active]').style.transition = '';
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
  // The mood preview shows the character in every state.
  await workspace.getByRole('button', { name: /in every mood/ }).click();
  await expect(workspace.getByRole('list', { name: /in every mood/ }).getByRole('img')).toHaveCount(
    13,
  );
  if (screenshotDirectory)
    await workspace.screenshot({ path: join(screenshotDirectory, 'appearance.png') });

  // Reduced motion preserves the semantic face without moving it.
  await pet.emulateMedia({ reducedMotion: 'reduce' });
  await show('speaking');
  await expect.poll(() => activeVariant('mouth')).toBe('talk');
  await expect(pet.locator('[data-part="mouth"] > [data-active]')).toHaveCSS(
    'animation-name',
    'none',
  );
  await expect(pet.locator('.pet-body')).toHaveCSS('animation-name', 'none');

  console.log(
    'PASS: both built-in characters render every state and mood with one variant per part and reduced-motion safety.',
  );
} finally {
  await instance?.close();
}
