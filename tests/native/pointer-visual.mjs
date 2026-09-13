// Renders Edi's pointer overlay over the grounding fixture twice: with deliberately inaccurate
// model coordinates, and after aligning them with real Vision text recognition. Checks where
// the hand comes to rest and saves both frames for review.
import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import {
  groundPresentation,
  localizeActions,
  resolvePresentation,
  screenTextSchema,
} from '../../packages/contracts/src/index.ts';

const out = process.env.EDI_SCREENSHOTS || (await mkdtemp(join(tmpdir(), 'edi-pointer-')));
const koffi = createRequire(resolve('apps/desktop/package.json'))('koffi');
const lib = koffi.load(resolve('native/screen-capture/build/libedi_screen_ask.dylib'));
const start = lib.func('edi_start_text_recognition_file', 'void', ['str', 'uint32']);
const state = lib.func('edi_text_state', 'int', ['uint32']);
const length = lib.func('edi_text_length', 'int', ['uint32']);
const take = lib.func('edi_take_text', 'void', ['uint32', 'void *', 'int']);
start(resolve('tests/fixtures/grounding-screen.png'), 7);
while (state(7) === 1) await new Promise(done => setTimeout(done, 20));
const bytes = Buffer.alloc(length(7));
take(7, bytes, bytes.length);
const text = screenTextSchema.parse(JSON.parse(bytes.toString('utf8')));

const fixture = JSON.parse(await readFile('tests/fixtures/grounding-screen.json', 'utf8'));
const { width, height } = fixture.page;
const image = { width: 1280, height: Math.round((1280 * height) / width) };
const center = id => {
  const r = fixture.targets[id];
  return {
    x: ((r.x + r.width / 2) / width) * image.width,
    y: ((r.y + r.height / 2) / height) * image.height,
  };
};
const [save, cancel, wifi, privacy, pdf] = ['save', 'cancel', 'wifi', 'privacy', 'pdf'].map(center);
const round = Math.round;
const raw = {
  screen: 1,
  actions: [
    { type: 'circle', x: round(save.x + 16), y: round(save.y - 10), r: 22, label: 'Save' },
    { type: 'box', x: round(cancel.x - 40), y: round(cancel.y - 4), w: 70, h: 30, label: 'Cancel' },
    {
      type: 'underline',
      x1: round(privacy.x - 30),
      y1: round(privacy.y + 18),
      x2: round(privacy.x + 60),
      y2: round(privacy.y + 18),
      label: 'Privacy & Security',
    },
    {
      type: 'arrow',
      x1: round(pdf.x + 160),
      y1: round(pdf.y + 60),
      x2: round(pdf.x + 22),
      y2: round(pdf.y + 12),
      label: 'PDF',
    },
    { type: 'point', x: round(wifi.x - 18), y: round(wifi.y + 12), label: 'Wi-Fi' },
  ],
};
const display = { x: 0, y: 0, width, height };
const shots = [{ ...image, display }];
const grounded = groundPresentation(raw, image, text);
expect(grounded.grounded).toBe(raw.actions.length);
const frames = {
  before: resolvePresentation(raw, shots).actions,
  after: resolvePresentation(grounded, shots).actions,
};

const png = `data:image/png;base64,${(await readFile('tests/fixtures/grounding-screen.png')).toString('base64')}`;
const profile = await mkdtemp(join(tmpdir(), 'edi-pointer-profile-'));
const app = await electron.launch({
  env: { ...process.env, EDI_VOICE: 'off', EDI_MODEL_CATALOG: 'off' },
  executablePath: resolve(
    'apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
  ),
  args: [resolve('apps/desktop'), `--user-data-dir=${profile}`],
});
try {
  await expect
    .poll(() => app.windows().filter(page => page.url().includes('surface=')).length)
    .toBe(2);
  const base = app
    .windows()
    .find(page => page.url().includes('surface=workspace'))
    .url()
    .split('?')[0];
  for (const [name, actions] of Object.entries(frames)) {
    const query = new URLSearchParams({
      surface: 'pointer',
      fromX: '1700',
      fromY: '1050',
      skin: 'edi',
      actions: JSON.stringify(localizeActions(actions, display)),
    });
    const count = app.windows().length;
    await app.evaluate(
      async ({ BrowserWindow }, { url, width, height }) => {
        const win = new BrowserWindow({ width, height, webPreferences: { sandbox: true } });
        await win.loadURL(url);
      },
      { url: `${base}?${query}`, width, height },
    );
    await expect.poll(() => app.windows().length).toBe(count + 1);
    const page = app.windows().at(-1);
    await page.setViewportSize({ width, height });
    await page.evaluate(src => {
      document.documentElement.style.background = `url(${src}) 0 0 / 100% 100%`;
    }, png);
    await expect(page.locator('.pointer-label', { hasText: 'Wi-Fi' })).toBeVisible({
      timeout: 15_000,
    });
    // The hand rests on the last target instead of jumping back to an earlier drawing.
    const last = actions.at(-1);
    const hand = await page.locator('.pointer').evaluate(el => {
      const matrix = new DOMMatrix(getComputedStyle(el).transform);
      return { x: matrix.e, y: matrix.f };
    });
    // A pointed target keeps the fingertip just under it so the hand never covers it.
    expect(Math.abs(hand.x - last.x)).toBeLessThanOrEqual(2);
    expect(hand.y - last.y).toBeGreaterThanOrEqual(6);
    expect(hand.y - last.y).toBeLessThanOrEqual(10);
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(out, `pointer-${name}.png`) });
    await page.close();
  }
  console.log(`PASS: pointer rests on its last target; frames saved in ${out}`);
} finally {
  await app.close();
}
