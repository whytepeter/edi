import type { BrowserWindow } from 'electron';
import { mapSkinPoint, skinGeometry, type SkinId } from '@edi/contracts';
import type { PointTarget } from '../agent/agent-service';

type Display = PointTarget['display'];

/** How long a pointer stays up unless something newer replaces it. */
const POINTER_MS = 8000;

interface PointerOptions {
  pet: BrowserWindow;
  skin: () => SkinId;
  create: (display: Display, params: Record<string, string>) => BrowserWindow;
}

/**
 * Shows where a reply points: Edi's pointer travels from its hand to the target on
 * the target's display, then labels it. One at a time; new work dismisses it.
 */
export class PointerOverlay {
  private window?: BrowserWindow;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private readonly options: PointerOptions) {}

  show(target: PointTarget) {
    this.dismiss();
    const { display } = target;
    const geometry = skinGeometry[this.options.skin()];
    const hand = mapSkinPoint(geometry, geometry.anchors.rightHand, this.options.pet.getBounds());
    // If Edi is on another display, the pointer enters from the edge nearest to it.
    const from = {
      x: Math.min(Math.max(hand.x, display.x), display.x + display.width),
      y: Math.min(Math.max(hand.y, display.y), display.y + display.height),
    };
    const local = (point: { x: number; y: number }) => ({
      x: String(Math.round(point.x - display.x)),
      y: String(Math.round(point.y - display.y)),
    });
    const start = local(from);
    const end = local(target);
    const win = this.options.create(display, {
      fromX: start.x,
      fromY: start.y,
      toX: end.x,
      toY: end.y,
      label: target.label,
      skin: this.options.skin(),
    });
    this.window = win;
    win.once('ready-to-show', () => {
      if (this.window === win && !win.isDestroyed()) win.showInactive();
    });
    this.timer = setTimeout(() => this.dismiss(), POINTER_MS);
  }

  dismiss() {
    clearTimeout(this.timer);
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = undefined;
  }
}
