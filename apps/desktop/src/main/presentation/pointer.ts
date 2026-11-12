import type { BrowserWindow } from 'electron';
import { handTip, localizeActions, mapSkinPoint, type CharacterManifest } from '@edi/contracts';
import type { PointTarget } from '../agent/agent-service';

type Display = PointTarget['display'];

/** How long a pointer stays up unless something newer replaces it. */
const POINTER_MS = 8000;
/** While Edi is still speaking or the answer is still on show, checked this often. */
const KEEP_CHECK_MS = 1000;
/** However long the answer runs, a pointer never outstays this. */
export const POINTER_MAX_MS = 45_000;

interface PointerOptions {
  pet: BrowserWindow;
  /** The current character: where its hand is, and the pointer's colors. */
  character: () => CharacterManifest;
  create: (display: Display, params: Record<string, string>) => BrowserWindow;
  /**
   * True while the answer the pointer belongs to is still being spoken or read. The pointer
   * stays for it: a fixed few seconds took the hand away halfway through a spoken explanation.
   */
  keepWhile?: () => boolean;
  now?: () => number;
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
    const now = this.options.now ?? Date.now;
    const shownAt = now();
    const leave = () => {
      if (this.window !== win) return;
      const outstayed = now() - shownAt >= POINTER_MAX_MS;
      if (!outstayed && this.options.keepWhile?.()) this.timer = setTimeout(leave, KEEP_CHECK_MS);
      else this.dismiss();
    };
    this.timer = setTimeout(leave, POINTER_MS + target.actions.length * 1500);
  }

  dismiss() {
    clearTimeout(this.timer);
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = undefined;
  }
}
