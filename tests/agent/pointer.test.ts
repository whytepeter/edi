import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BrowserWindow } from 'electron';
import { PointerOverlay, POINTER_MAX_MS } from '../../apps/desktop/src/main/presentation/pointer';
import type { CharacterManifest } from '../../packages/contracts/src/index';

const display = { id: 1, x: 0, y: 0, width: 1512, height: 982 };
const target = {
  display,
  actions: [{ type: 'point' as const, x: 400, y: 300, label: 'Save' }],
} as unknown as Parameters<PointerOverlay['show']>[0];

function overlay(keepWhile?: () => boolean) {
  const state = { destroyed: 0, created: 0 };
  const window = () => {
    let gone = false;
    return {
      isDestroyed: () => gone,
      destroy: () => {
        gone = true;
        state.destroyed++;
      },
      once: () => {},
      showInactive: () => {},
    } as unknown as BrowserWindow;
  };
  const pointer = new PointerOverlay({
    pet: { getBounds: () => ({ x: 100, y: 100, width: 160, height: 170 }) } as BrowserWindow,
    character: () =>
      ({
        colors: { accent: '#335577', outline: '#223344', skin: '#ffeecc' },
        geometry: {
          version: 1,
          viewBox: { x: 0, y: 0, width: 160, height: 170 },
          paintedBounds: { x: 10, y: 10, width: 140, height: 150 },
          bodyPath: 'M0 0Z',
          anchors: {
            workspace: { x: 31, y: 40 },
            leftHand: { x: 30, y: 99 },
            rightHand: { x: 132, y: 112 },
            speechRight: { x: 122, y: 54 },
            speechLeft: { x: 40, y: 54 },
          },
        },
      }) as unknown as CharacterManifest,
    create: () => {
      state.created++;
      return window();
    },
    ...(keepWhile ? { keepWhile } : {}),
  });
  return { pointer, state };
}

test('a pointer leaves after a few seconds when nothing is still being said', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { pointer, state } = overlay();
  pointer.show(target);
  t.mock.timers.tick(9_000);
  assert.equal(state.destroyed, 0);
  t.mock.timers.tick(600);
  assert.equal(state.destroyed, 1);
});

test('it stays while Edi is still speaking about it, then leaves, and never outstays its limit', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let speaking = true;
  const { pointer, state } = overlay(() => speaking);
  pointer.show(target);
  t.mock.timers.tick(20_000);
  assert.equal(state.destroyed, 0, 'still explaining');
  speaking = false;
  t.mock.timers.tick(1_100);
  assert.equal(state.destroyed, 1);

  // An answer that never ends cannot leave a hand on the screen for ever.
  speaking = true;
  pointer.show(target);
  t.mock.timers.tick(POINTER_MAX_MS + 2_000);
  assert.equal(state.destroyed, 2);
});

test('a new pointer replaces the old one at once', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { pointer, state } = overlay(() => true);
  pointer.show(target);
  pointer.show(target);
  assert.deepEqual([state.created, state.destroyed], [2, 1]);
  pointer.dismiss();
  assert.equal(state.destroyed, 2);
});
