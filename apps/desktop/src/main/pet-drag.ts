import { screen, type BrowserWindow } from 'electron';
import { clampWindow, petDragThreshold, type Command, type Rect } from '@edi/contracts';

type DragCommand = Extract<Command, { type: 'pet-drag' }>;
type Point = { x: number; y: number };
interface Gesture {
  pointerId: number;
  origin: Point;
  bounds: Rect;
  moved: boolean;
}

/** Moves only Edi's window. No mouse automation or privileged external-window access. */
export class PetDrag {
  private gesture?: Gesture;
  private watchdog?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly pet: BrowserWindow,
    private readonly repositionCard: () => void,
    private readonly save: (point: Point) => Promise<void>,
  ) {}

  get active() {
    return this.gesture !== undefined;
  }

  async handle(command: DragCommand) {
    const { point, pointerId, phase } = command;
    if (phase === 'start') {
      if (this.gesture) return;
      const bounds = this.pet.getBounds();
      // A compromised pet renderer still cannot begin a drag outside its own window.
      if (
        point.x < bounds.x ||
        point.x > bounds.x + bounds.width ||
        point.y < bounds.y ||
        point.y > bounds.y + bounds.height
      )
        return;
      this.gesture = { pointerId, origin: point, bounds, moved: false };
      this.pet.setIgnoreMouseEvents(false);
      this.watchdog = setTimeout(() => this.cancel(), 120000);
      return;
    }
    const gesture = this.gesture;
    if (!gesture || gesture.pointerId !== pointerId) return;
    if (phase === 'cancel') {
      this.cancel();
      return;
    }

    const dx = point.x - gesture.origin.x;
    const dy = point.y - gesture.origin.y;
    gesture.moved ||= Math.hypot(dx, dy) >= petDragThreshold;
    if (gesture.moved) {
      // Preserve the original grab offset, even after clamping at a display edge.
      const proposed = { ...gesture.bounds, x: gesture.bounds.x + dx, y: gesture.bounds.y + dy };
      const area = screen.getDisplayNearestPoint(point).workArea;
      this.pet.setBounds(clampWindow(proposed, area));
      this.repositionCard();
    }
    if (phase === 'end') {
      this.clear();
      if (gesture.moved) {
        const { x, y } = this.pet.getBounds();
        await this.save({ x, y });
      }
    }
  }

  cancel = () => {
    const gesture = this.gesture;
    this.clear();
    if (!gesture || this.pet.isDestroyed()) return;
    const area = screen.getDisplayMatching(gesture.bounds).workArea;
    this.pet.setBounds(clampWindow(gesture.bounds, area));
    this.repositionCard();
  };

  private clear() {
    clearTimeout(this.watchdog);
    this.gesture = undefined;
    if (!this.pet.isDestroyed()) this.pet.setIgnoreMouseEvents(true, { forward: true });
  }
}
