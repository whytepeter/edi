import type { BrowserWindow } from 'electron';

type Display = { id: number; x: number; y: number; width: number; height: number };

/** A mark the person drew, in global logical screen coordinates. */
export interface Mark {
  displayId: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface AnnotationOptions {
  /** The display the pointer is on right now. */
  displayUnderCursor: () => Display;
  create: (display: Display, params: Record<string, string>) => BrowserWindow;
  /** The character's accent: the person's ink matches the companion. */
  accent: () => string;
}

/**
 * Marks the person draws on their own screen to say “this bit”. While Edi is listening the
 * overlay takes the drag; the mark stays until the answer is done, so the screenshot Edi takes
 * contains it. Nothing here moves or clicks their pointer.
 */
export class Annotations {
  private window?: BrowserWindow;
  private display?: Display;
  private marks: Mark[] = [];

  constructor(private readonly options: AnnotationOptions) {}

  /** Windows that must stay visible to the capture, unlike the rest of Edi's. */
  get captured(): BrowserWindow[] {
    const win = this.live;
    return win ? [win] : [];
  }

  private get live() {
    return this.window && !this.window.isDestroyed() ? this.window : undefined;
  }

  /** Edi started listening: let a drag draw on the display the person is working on. */
  arm() {
    const display = this.options.displayUnderCursor();
    const existing = this.live;
    if (existing && this.display?.id === display.id) {
      existing.setIgnoreMouseEvents(false);
      existing.showInactive();
      return;
    }
    existing?.destroy();
    this.marks = [];
    this.display = display;
    const win = this.options.create(display, { accent: this.options.accent() });
    this.window = win;
    win.setIgnoreMouseEvents(false);
    win.once('ready-to-show', () => {
      if (this.window === win && !win.isDestroyed()) win.showInactive();
    });
    win.on('closed', () => {
      if (this.window === win) this.window = undefined;
    });
  }

  /** Edi stopped listening: the marks stay on screen, but clicks pass through again. */
  release() {
    this.live?.setIgnoreMouseEvents(true);
    // Nothing drawn: no reason to keep a layer over their screen.
    if (!this.marks.length) this.clear();
  }

  owns(sender: Electron.WebContents) {
    return this.live?.webContents === sender;
  }

  /** A stroke finished, in the overlay's own pixels: its box on the shared desktop. */
  drew(box: { x: number; y: number; width: number; height: number }) {
    const display = this.display;
    if (!display || !this.live) return;
    this.marks = [
      ...this.marks.slice(-4),
      {
        displayId: display.id,
        x: display.x + box.x,
        y: display.y + box.y,
        width: box.width,
        height: box.height,
      },
    ];
  }

  /** What the person marked, for the question they are asking now. */
  current(): Mark[] {
    return this.live ? this.marks : [];
  }

  /**
   * The answer is done (or a new turn began): the screen goes back to being theirs. The overlay
   * goes with the marks, so the next question starts on a clean one.
   */
  clear() {
    this.marks = [];
    this.live?.destroy();
    this.window = undefined;
    this.display = undefined;
  }
}
