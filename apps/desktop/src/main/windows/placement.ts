import { screen, type BrowserWindow } from 'electron';
import { clampWindow, mapSkinPoint, placeCard, skinGeometry, type SkinId } from '@edi/contracts';

/** Own placement separately from IPC and rendering so every summon path behaves alike. */
export class WindowPlacement {
  constructor(
    private readonly pet: BrowserWindow,
    private readonly card: BrowserWindow,
    private readonly skin: () => SkinId,
    private readonly pinned: () => boolean,
  ) {}

  place(size = this.card.getBounds()) {
    if (this.pinned()) {
      const old = this.card.getBounds();
      const area = screen.getDisplayMatching(old).workArea;
      this.card.setBounds(clampWindow({ ...old, width: size.width, height: size.height }, area));
      return;
    }
    const petBounds = this.pet.getBounds();
    const geometry = skinGeometry[this.skin()];
    const anchor = mapSkinPoint(geometry, geometry.anchors.workspace, petBounds);
    const area = screen.getDisplayMatching(petBounds).workArea;
    this.card.setBounds(placeCard(anchor, size, area));
  }

  show() {
    this.place();
    this.card.show();
  }

  /** Recover off-screen windows after display removal or a work-area change. */
  recover = () => {
    if (this.pet.isDestroyed() || this.card.isDestroyed()) return;
    const bounds = this.pet.getBounds();
    this.pet.setBounds(clampWindow(bounds, screen.getDisplayMatching(bounds).workArea));
    this.place();
  };
}
