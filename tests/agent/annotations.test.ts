import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BrowserWindow } from 'electron';
import { Annotations } from '../../apps/desktop/src/main/presentation/annotations';

const display = { id: 1, x: 0, y: 0, width: 1512, height: 982 };
const second = { id: 2, x: 1512, y: 0, width: 1920, height: 1080 };

/** A stand-in for the overlay window: records what main asks of it. */
function fakeWindow() {
  const state = { destroyed: false, ignoring: true, shown: false };
  const win = {
    webContents: {},
    isDestroyed: () => state.destroyed,
    destroy: () => {
      state.destroyed = true;
    },
    setIgnoreMouseEvents: (value: boolean) => {
      state.ignoring = value;
    },
    showInactive: () => {
      state.shown = true;
    },
    hide: () => {
      state.shown = false;
    },
    once: () => win,
    on: () => win,
  } as unknown as BrowserWindow;
  return { win, state };
}

function setup(on = display) {
  const windows: ReturnType<typeof fakeWindow>[] = [];
  let current = on;
  const annotations = new Annotations({
    displayUnderCursor: () => current,
    create: () => {
      const made = fakeWindow();
      windows.push(made);
      return made.win;
    },
    accent: () => '#e0533d',
  });
  return { annotations, windows, move: (to: typeof display) => (current = to) };
}

test('a drag while listening becomes a mark on the shared desktop', () => {
  const { annotations, windows } = setup();
  annotations.arm();
  assert.equal(windows[0]!.state.ignoring, false, 'the drag reaches the overlay while held');
  annotations.drew({ x: 100, y: 50, width: 200, height: 120 });
  annotations.release();
  assert.equal(windows[0]!.state.ignoring, true, 'clicks pass through again afterwards');
  assert.deepEqual(annotations.current(), [
    { displayId: 1, x: 100, y: 50, width: 200, height: 120 },
  ]);
  // The overlay stays visible so the mark is in the screenshot Edi takes.
  assert.deepEqual(annotations.captured.length, 1);
});

test('marks last for one question: the answer, a new hold, or a wait clears them', async t => {
  const { annotations, windows } = setup();
  // Answered: the marks and the overlay go.
  annotations.arm();
  annotations.drew({ x: 10, y: 10, width: 40, height: 40 });
  annotations.release();
  annotations.keep();
  annotations.clear();
  assert.deepEqual(annotations.current(), []);
  assert.equal(windows[0]!.state.destroyed, true);

  // A new hold starts the next question clean, even on the same screen.
  annotations.arm();
  annotations.drew({ x: 1, y: 2, width: 3, height: 4 });
  annotations.arm();
  assert.deepEqual(annotations.current(), []);

  // Nothing was asked: the ink is not left on their screen for ever.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  annotations.drew({ x: 5, y: 5, width: 5, height: 5 });
  annotations.release();
  assert.equal(annotations.current().length, 1);
  t.mock.timers.tick(45_000);
  assert.deepEqual(annotations.current(), []);
  t.mock.timers.reset();
});

test('nothing drawn leaves no layer over the screen, and marks follow the display', () => {
  const { annotations, windows, move } = setup();
  annotations.arm();
  annotations.release();
  assert.equal(windows[0]!.state.destroyed, true, 'an empty overlay is dismissed');
  assert.deepEqual(annotations.captured, []);

  // A hold on another screen draws there, and the box is placed on that screen.
  move(second);
  annotations.arm();
  annotations.drew({ x: 20, y: 30, width: 50, height: 60 });
  assert.deepEqual(annotations.current(), [
    { displayId: 2, x: 1532, y: 30, width: 50, height: 60 },
  ]);
});
