import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  groundPresentation,
  labelTarget,
  resolvePresentation,
  screenTextSchema,
  textSimilarity,
  type PresentationAction,
  type ScreenText,
} from './index';

const image = { width: 1000, height: 500 };
/** A line of words laid out left to right, in image pixels. */
function line(
  y: number,
  words: [text: string, x: number, width: number][],
  height = 20,
): ScreenText[number] {
  const n = (v: number, size: number) => v / size;
  const left = words[0]![1];
  const last = words.at(-1)!;
  return {
    t: words.map(w => w[0]).join(' '),
    c: 1,
    b: [n(left, 1000), n(y, 500), n(last[1] + last[2] - left, 1000), n(height, 500)],
    w: words.map(([t, x, w]) => ({
      t,
      b: [n(x, 1000), n(y, 500), n(w, 1000), n(height, 500)] as [number, number, number, number],
    })),
  };
}
const toolbar = line(100, [
  ['Save', 400, 40],
  ['Cancel', 460, 60],
]);
const menu = line(10, [['Wi-Fi', 800, 50]]);
const text = screenTextSchema.parse([toolbar, menu, line(300, [['Save', 100, 40]])]);

const ground = (action: PresentationAction) =>
  groundPresentation({ screen: 1, actions: [action] }, image, text);

test('labels reduce to the visible text they name', () => {
  assert.equal(labelTarget('the Save button'), 'save');
  assert.equal(labelTarget('Wi-Fi icon in the menu bar'), 'wi fi');
  assert.equal(labelTarget('Menu'), 'menu');
  assert.equal(textSimilarity('wi fi', 'Wi-Fi'), 1);
  assert.equal(textSimilarity('ok', 'OK'), 1);
  assert.equal(textSimilarity('ok', 'Book'), 0);
});

test('a rough point snaps to the center of the nearest matching word', () => {
  const result = ground({ type: 'point', x: 432, y: 131, label: 'Save button' });
  assert.equal(result.grounded, 1);
  assert.deepEqual(result.actions[0], { type: 'point', x: 420, y: 110, label: 'Save button' });
});

test('the nearest of two identical labels wins', () => {
  const result = ground({ type: 'point', x: 140, y: 280, label: 'Save' });
  assert.deepEqual(result.actions[0], { type: 'point', x: 120, y: 310, label: 'Save' });
});

test('matches too far from where the model aimed are ignored', () => {
  const action: PresentationAction = { type: 'point', x: 700, y: 450, label: 'Save' };
  const result = ground(action);
  assert.equal(result.grounded, 0);
  assert.deepEqual(result.actions[0], action);
});

test('unrelated text never captures an action', () => {
  const action: PresentationAction = { type: 'point', x: 425, y: 110, label: 'Share icon' };
  assert.deepEqual(ground(action).actions[0], action);
});

test('shapes fit the target: boxes pad it, circles around wide text become ellipses', () => {
  const box = ground({ type: 'box', x: 380, y: 80, w: 120, h: 40, label: 'Cancel' }).actions[0];
  assert.deepEqual(box, { type: 'box', x: 453, y: 93, w: 74, h: 34, label: 'Cancel' });
  const circle = ground({ type: 'circle', x: 470, y: 95, r: 50, label: 'Cancel' }).actions[0];
  assert.equal(circle?.type, 'ellipse');
  if (circle?.type === 'ellipse') {
    assert.deepEqual([circle.x, circle.y], [490, 110]);
    // The ellipse encloses the word's corners.
    assert.ok((30 / circle.rx) ** 2 + (10 / circle.ry) ** 2 <= 1);
  }
  const underline = ground({
    type: 'underline',
    x1: 380,
    y1: 140,
    x2: 450,
    y2: 140,
    label: 'Save',
  });
  assert.deepEqual(underline.actions[0], {
    type: 'underline',
    x1: 400,
    y1: 124,
    x2: 440,
    y2: 124,
    label: 'Save',
  });
});

test('an arrow keeps its tail and stops just outside the target', () => {
  const arrow = ground({ type: 'arrow', x1: 420, y1: 250, x2: 430, y2: 150, label: 'Save' });
  const action = arrow.actions[0];
  assert.equal(action?.type, 'arrow');
  if (action?.type === 'arrow') {
    assert.deepEqual([action.x1, action.y1], [420, 250]);
    assert.deepEqual([action.x2, action.y2], [420, 127]);
  }
});

test('grounded ellipses still map from screenshot pixels to the display', () => {
  const grounded = ground({ type: 'circle', x: 470, y: 95, r: 50, label: 'Cancel' });
  const resolved = resolvePresentation(grounded, [
    { width: 1000, height: 500, display: { x: -2000, y: 0, width: 2000, height: 1000 } },
  ]);
  assert.equal(resolved?.actions[0]?.type, 'ellipse');
  if (resolved?.actions[0]?.type === 'ellipse') assert.equal(resolved.actions[0].x, -1020);
});
