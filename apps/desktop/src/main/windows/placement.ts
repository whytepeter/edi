import { screen, type BrowserWindow } from 'electron';
import { clampWindow, mapSkinPoint, placeCard, skinGeometry, type SkinId } from '@edi/contracts';

/** Own placement separately from IPC and rendering so every summon path behaves alike. */
export class WindowPlacement {
  constructor(
    private readonly pet: BrowserWindow,
    private readonly card: BrowserWindow,
    private readonly skin: () => SkinId,
    /** Windows that sit beside the card (shown content) move with it. */
    private readonly onPlaced: () => void = () => {},
  ) {}

  /**
   * The card always sits beside Edi, including while Edi is dragged. Pinning only keeps it
   * from closing when another app takes focus; it never leaves the card behind.
   */
  place(size = this.card.getBounds()) {
    const petBounds = this.pet.getBounds();
    const geometry = skinGeometry[this.skin()];
    const anchor = mapSkinPoint(geometry, geometry.anchors.workspace, petBounds);
    const area = screen.getDisplayMatching(petBounds).workArea;
    this.card.setBounds(placeCard(anchor, size, area));
    this.onPlaced();
  }

  show() {
    this.place();
    this.card.show();
  }

  /** Bring the card up without taking focus, so stray keystrokes cannot act in it. */
  reveal() {
    this.place();
    this.card.showInactive();
  }

  /** Recover off-screen windows after display removal or a work-area change. */
  recover = () => {
    if (this.pet.isDestroyed() || this.card.isDestroyed()) return;
    const bounds = this.pet.getBounds();
    this.pet.setBounds(clampWindow(bounds, screen.getDisplayMatching(bounds).workArea));
    this.place();
  };
}
