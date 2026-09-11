import { BrowserWindow, screen, type MenuItemConstructorOptions } from 'electron';
import { clampWindow } from '@edi/contracts';

/** One entry point for character clicks, menu actions and the global shortcut. */
export class CharacterActions {
  private bubble?: BrowserWindow;
  private menu?: BrowserWindow;
  private mode: 'conversation' | 'push-to-talk' = 'conversation';
  private dismiss?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly pet: BrowserWindow,
    private readonly card: BrowserWindow,
    private readonly showContent: () => void,
    private readonly stopWork: () => void,
    private readonly createBubble: () => BrowserWindow,
    private readonly quit: () => void,
    private readonly createMenu: () => BrowserWindow,
  ) {
    pet.on('move', this.placeBubble);
  }

  requestListening = (mode: 'conversation' | 'push-to-talk' = 'conversation') => {
    this.hideMenu();
    this.mode = mode;
    this.stopWork();
    this.pet.showInactive();
    // Capture/transcription is not connected yet. Never claim the mic is active.
    this.hideBubble();
    const bubble = this.createBubble();
    this.bubble = bubble;
    bubble.setIgnoreMouseEvents(true);
    this.placeBubble();
    bubble.once('ready-to-show', () => {
      if (bubble.isDestroyed() || this.bubble !== bubble) return;
      bubble.showInactive();
      this.dismiss = setTimeout(() => this.hideBubble(), 5000);
    });
  };

  private placeBubble = () => {
    if (!this.bubble || this.bubble.isDestroyed()) return;
    const pet = this.pet.getBounds();
    const area = screen.getDisplayMatching(pet).workArea;
    const size = this.bubble.getBounds();
    this.bubble.setBounds(clampWindow({ width: size.width, height: size.height,
      x: pet.x + pet.width + size.width <= area.x + area.width ? pet.x + pet.width - 8 : pet.x - size.width + 8,
      y: pet.y + 12 }, area));
  };

  private hideBubble() {
    clearTimeout(this.dismiss);
    this.bubble?.destroy();
    this.bubble = undefined;
  }

  stop = () => { this.stopWork(); this.hideBubble(); };
  sleep = () => { this.hideMenu(); this.stop(); this.card.hide(); this.pet.hide(); };
  releaseListening() {
    // No submission until capture exists; a release must never start conversation.
    if (this.mode === 'push-to-talk') this.stop();
  }

  menuItems(): MenuItemConstructorOptions[] {
    return [
      { label: 'Listen', click: () => this.requestListening() },
      { label: 'Show content', click: () => { this.hideBubble(); this.showContent(); } },
      { label: 'Stop', click: this.stop },
      { type: 'separator' },
      { label: 'Sleep Edi', click: this.sleep },
      { label: 'Quit Edi', click: this.quit },
    ];
  }

  ownsMenu(contents: Electron.WebContents) { return this.menu?.webContents === contents; }
  private hideMenu() { this.menu?.destroy(); this.menu = undefined; }
  action(action: 'conversation' | 'content' | 'stop' | 'sleep' | 'quit' | 'dismiss') {
    this.hideMenu();
    if (action === 'conversation') this.requestListening();
    if (action === 'content') { this.hideBubble(); this.showContent(); }
    if (action === 'stop') this.stop();
    if (action === 'sleep') this.sleep();
    if (action === 'quit') this.quit();
  }
  showMenu = () => {
    this.hideMenu();
    const menu = this.createMenu();
    this.menu = menu;
    const pet = this.pet.getBounds();
    const size = menu.getBounds();
    menu.setBounds(clampWindow({ x: pet.x - size.width + 24, y: pet.y - size.height + 40,
      width: size.width, height: size.height }, screen.getDisplayMatching(pet).workArea));
    menu.once('ready-to-show', () => { if (!menu.isDestroyed()) menu.show(); });
    menu.on('blur', () => { if (this.menu === menu) this.hideMenu(); });
  };
  dispose() { this.hideMenu(); this.hideBubble(); this.pet.removeListener('move', this.placeBubble); }
}
