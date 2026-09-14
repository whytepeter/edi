import { screen, type BrowserWindow, type WebContents } from 'electron';
import { placeArtifact, type ArtifactRef, type Rect } from '@edi/contracts';
import { artifactWindowSize, createArtifactWindow } from './factory';

type Bounds = Rect;

/**
 * One reusable window for shown content. Opening something new replaces what it shows.
 * It follows the card until the person moves or resizes it themselves.
 */
export class ArtifactWindow {
  private win: BrowserWindow | null = null;
  private placedByUser = false;
  private placing = false;
  private showing: ArtifactRef | null = null;

  constructor(
    private readonly bounds: () => { card: Bounds; pet: Bounds },
    private readonly onBlur: () => void,
    /** Prepares the sandboxed session interactive pages load in, before the first window. */
    private readonly prepare: () => void = () => {},
  ) {}

  get window() {
    return this.win && !this.win.isDestroyed() ? this.win : null;
  }

  owns(sender: WebContents) {
    return this.window?.webContents === sender;
  }

  isVisible() {
    return Boolean(this.window?.isVisible());
  }

  open(ref: ArtifactRef) {
    this.placedByUser = false;
    this.showing = ref;
    const existing = this.window;
    if (existing) {
      existing.webContents.send('edi:open-artifact', ref);
      this.follow();
      existing.show();
      return existing;
    }
    this.prepare();
    const win = createArtifactWindow(ref);
    this.win = win;
    this.follow();
    // A drag or resize from the person wins over automatic placement.
    const userPlaced = () => {
      if (!this.placing) this.placedByUser = true;
    };
    win.on('will-move', userPlaced);
    win.on('will-resize', userPlaced);
    win.on('blur', this.onBlur);
    win.on('closed', () => {
      if (this.win === win) this.win = null;
    });
    win.once('ready-to-show', () => win.show());
    return win;
  }

  /** Keep beside the card (called whenever the card is placed). */
  follow() {
    const win = this.window;
    if (!win || this.placedByUser) return;
    const { card, pet } = this.bounds();
    const area = screen.getDisplayMatching(card).workArea;
    this.placing = true;
    try {
      win.setBounds(placeArtifact(card, pet, area, artifactWindowSize));
    } finally {
      this.placing = false;
    }
  }

  hide() {
    this.window?.hide();
  }

  close() {
    this.window?.close();
  }

  /** After something is deleted, a window still showing it closes. */
  closeIfShowing(id: string) {
    const ref = this.showing;
    if (ref && ('callId' in ref ? ref.callId : ref.noteId) === id) this.close();
  }
}
