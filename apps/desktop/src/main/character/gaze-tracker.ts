import { screen, type BrowserWindow } from 'electron';
import { gazeToward, noGaze, type Gaze } from '@edi/contracts';

/** While the pointer moves, 30 looks a second; once it rests, only enough to notice it move again. */
const ACTIVE_MS = 33;
const RESTING_MS = 160;
/** How long the pointer must sit still before polling slows down. */
const REST_AFTER_MS = 1500;

/**
 * Tells the pet window where the pointer is, relative to Edi, so the eyes can follow it. The
 * pet window is click-through and never receives pointer events outside its own shape, so main
 * reads the pointer position itself. It reads only that point, sends only a direction and a
 * distance to Edi's own window, and polls only while Edi is on screen. Nothing is captured or
 * stored.
 */
export class GazeTracker {
  private timer?: ReturnType<typeof setTimeout>;
  private last: Gaze = noGaze;
  private lastMovedAt = 0;

  constructor(
    private readonly pet: BrowserWindow,
    private readonly send: (gaze: Gaze) => void,
  ) {
    pet.on('show', this.start);
    pet.on('hide', this.stop);
    pet.once('closed', () => this.dispose());
    if (pet.isVisible()) this.start();
  }

  private start = () => {
    if (this.timer) return;
    this.lastMovedAt = Date.now();
    this.tick();
  };

  private stop = () => {
    clearTimeout(this.timer);
    this.timer = undefined;
  };

  private tick = () => {
    this.timer = undefined;
    if (this.pet.isDestroyed() || !this.pet.isVisible()) return;
    const cursor = screen.getCursorScreenPoint();
    const bounds = this.pet.getBounds();
    const gaze = gazeToward(
      { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
      cursor,
    );
    const now = Date.now();
    // Also covers Edi moving under a resting pointer: the direction changes without it moving.
    if (gaze.x !== this.last.x || gaze.y !== this.last.y) {
      this.last = gaze;
      this.lastMovedAt = now;
      this.send(gaze);
    }
    this.timer = setTimeout(
      this.tick,
      now - this.lastMovedAt > REST_AFTER_MS ? RESTING_MS : ACTIVE_MS,
    );
  };

  dispose() {
    this.stop();
    this.pet.removeListener('show', this.start);
    this.pet.removeListener('hide', this.stop);
  }
}
