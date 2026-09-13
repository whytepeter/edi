// Real Vision text recognition on a Retina-sized fixture, then grounding of deliberately
// inaccurate model coordinates. Needs the built native library, not Screen Recording.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { groundPresentation, screenTextSchema } from '../../packages/contracts/src/index.ts';

const koffi = createRequire(resolve('apps/desktop/package.json'))('koffi');
const lib = koffi.load(resolve('native/screen-capture/build/libedi_screen_ask.dylib'));
const start = lib.func('edi_start_text_recognition_file', 'void', ['str', 'uint32']);
const state = lib.func('edi_text_state', 'int', ['uint32']);
const length = lib.func('edi_text_length', 'int', ['uint32']);
const take = lib.func('edi_take_text', 'void', ['uint32', 'void *', 'int']);

const fixture = JSON.parse(readFileSync('tests/fixtures/grounding-screen.json', 'utf8'));
const KEY = 4242;
const started = performance.now();
start(resolve('tests/fixtures/grounding-screen.png'), KEY);
while (state(KEY) === 1 && performance.now() - started < 15_000)
  await new Promise(done => setTimeout(done, 20));
assert.equal(state(KEY), 2, 'text recognition finished');
const buffer = Buffer.alloc(length(KEY));
take(KEY, buffer, buffer.length);
assert.equal(state(KEY), 0, 'recognized text is dropped once read');
const text = screenTextSchema.parse(JSON.parse(buffer.toString('utf8')));
const elapsed = Math.round(performance.now() - started);

// The model sees a 1280-pixel-wide JPEG of the same screen.
const image = {
  width: 1280,
  height: Math.round((1280 * fixture.page.height) / fixture.page.width),
};
const toImage = rect => ({
  x: ((rect.x + rect.width / 2) / fixture.page.width) * image.width,
  y: ((rect.y + rect.height / 2) / fixture.page.height) * image.height,
});
// Typical estimation errors of a vision model on a downscaled screenshot.
const misses = [
  [18, -9],
  [-22, 14],
  [30, 6],
  [-12, -16],
  [25, 20],
  [-28, -4],
];
const labels = {
  save: 'the Save button',
  cancel: 'Cancel button',
  wifi: 'Wi-Fi in the menu bar',
  file: 'File menu',
  appearance: 'Appearance',
  privacy: 'Privacy & Security',
  pdf: 'PDF',
};

let before = 0;
let after = 0;
Object.entries(labels).forEach(([id, label], index) => {
  const truth = toImage(fixture.targets[id]);
  const [dx, dy] = misses[index % misses.length];
  const action = { type: 'point', x: Math.round(truth.x + dx), y: Math.round(truth.y + dy), label };
  const grounded = groundPresentation({ actions: [action] }, image, text);
  const point = grounded.actions[0];
  const error = Math.hypot(point.x - truth.x, point.y - truth.y);
  before += Math.hypot(dx, dy);
  after += error;
  assert.equal(grounded.grounded, 1, `${label} matched recognized text`);
  // One logical point is about 0.7 image pixels here; allow roughly 4 points.
  assert.ok(error <= 3, `${label}: ${error.toFixed(1)} image pixels from the real center`);
});

// Icons and unlabeled targets have no text to match, so they stay where the model put them.
const icon = { type: 'point', x: 900, y: 400, label: 'blue folder icon' };
assert.deepEqual(groundPresentation({ actions: [icon] }, image, text).actions[0], icon);

const count = Object.keys(labels).length;
console.log(
  `PASS: ${text.length} text lines recognized in ${elapsed} ms; mean pointer error ` +
    `${(before / count).toFixed(1)} → ${(after / count).toFixed(1)} image px across ${count} targets.`,
);
