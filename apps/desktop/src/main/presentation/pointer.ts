import type { BrowserWindow } from 'electron';
import { handTip, localizeActions, mapSkinPoint, type CharacterManifest } from '@edi/contracts';
import type { PointTarget } from '../agent/agent-service';

type Display = PointTarget['display'];

/** How long a pointer stays up unless something newer replaces it. */
const POINTER_MS = 8000;

interface PointerOptions {
  pet: BrowserWindow;
  /** The current character: where its hand is, and the pointer's colors. */
  character: () => CharacterManifest;
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
    const { geometry, colors } = this.options.character();
    const anchor = geometry.anchors.rightHand;
    const hand = mapSkinPoint(
      geometry,
      { x: anchor.x + handTip.x, y: anchor.y + handTip.y },
      this.options.pet.getBounds(),
    );
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
    const win = this.options.create(display, {
      fromX: start.x,
      fromY: start.y,
      actions: JSON.stringify(localizeActions(target.actions, display)),
      accent: colors.accent,
      outline: colors.outline,
      hand: colors.skin,
    });
    this.window = win;
    win.once('ready-to-show', () => {
      if (this.window === win && !win.isDestroyed()) win.showInactive();
    });
    this.timer = setTimeout(() => this.dismiss(), POINTER_MS + target.actions.length * 1500);
  }

  dismiss() {
    clearTimeout(this.timer);
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = undefined;
  }
}
