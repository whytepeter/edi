import { type BrowserWindow, screen, type MenuItemConstructorOptions } from 'electron';
import {
  mapSkinPoint,
  placeContextMenu,
  placeSpeechBubble,
  skinGeometry,
  type BubbleSide,
  type SkinId,
  type StatusBubbleState,
} from '@edi/contracts';
import {
  characterMenuSize,
  floatingMargin,
  statusBubbleSize,
  type StatusBubbleOptions,
} from '../windows/factory';

interface CharacterActionsOptions {
  pet: BrowserWindow;
  card: BrowserWindow;
  skin: () => SkinId;
  /** Whether hold-to-talk works right now (a local voice runtime is present). */
  voiceReady: () => boolean;
  /** How to start talking, shown when someone clicks instead of holding. */
  holdHint: () => string;
  showContent: () => void;
  stopWork: () => void;
  createBubble: (options: StatusBubbleOptions) => BrowserWindow;
  createMenu: () => BrowserWindow;
  quit: () => void;
}

type MenuAction = 'conversation' | 'content' | 'stop' | 'sleep' | 'quit' | 'dismiss';

/** One entry point for character clicks, menu actions and the global shortcut. */
export class CharacterActions {
  private bubble?: { window: BrowserWindow; state: StatusBubbleState; side: BubbleSide };
  private menu?: BrowserWindow;
  private mode: 'conversation' | 'push-to-talk' = 'conversation';
  private dismiss?: ReturnType<typeof setTimeout>;
  private replyText = '';
  private replyDone = false;
  private bubbleReady = false;

  /** Reuse the bubble window as tokens arrive; never reload it per token. */
  showReply = (text: string, done: boolean) => {
    this.replyText = text.slice(-600);
    this.replyDone = done;
    if (!this.replyText) {
      if (done) this.hideBubble();
      return;
    }
    clearTimeout(this.dismiss);
    if (this.bubble?.state !== 'notice') this.showStatus('notice');
    this.pushReply();
    if (done) this.dismiss = setTimeout(() => this.hideBubble(), 12000);
  };

  constructor(private readonly options: CharacterActionsOptions) {
    options.pet.on('move', this.followPet);
  }

  requestListening = (mode: 'conversation' | 'push-to-talk' = 'conversation') => {
    this.replyText = '';
    this.replyDone = false;
    this.hideMenu();
    this.mode = mode;
    this.options.stopWork();
    this.options.pet.showInactive();
    // Hands-free conversation is not built yet; only hold-to-talk listens. Never claim
    // the microphone is active when it is not.
    if (this.options.voiceReady()) this.showStatus('notice', 4000, this.options.holdHint());
    else this.showStatus('unavailable', 5000);
  };

  /** Mirror the agent: dots while waiting for the first words, gone once they arrive. */
  setThinking = (thinking: boolean) => {
    if (thinking && this.bubble?.state !== 'thinking' && this.bubble?.state !== 'notice') {
      this.replyText = '';
      this.replyDone = false;
      this.showStatus('thinking');
    }
  };

  /** Voice session feedback: live listening, thinking, a short notice, or nothing. */
  showVoiceStatus = (status: 'listening' | 'thinking' | 'hidden' | { notice: string }) => {
    if (status !== 'hidden') {
      this.replyText = '';
      this.replyDone = false;
    }
    if (status === 'hidden') {
      if (!this.replyText) this.hideBubble();
    } else if (typeof status === 'object') this.showStatus('notice', 4000, status.notice);
    else if (this.bubble?.state !== status) this.showStatus(status);
  };

  private showStatus(state: StatusBubbleState, dismissAfterMs?: number, text?: string) {
    this.hideBubble();
    const { bounds, side } = this.bubblePlacement(statusBubbleSize[state]);
    const window = this.options.createBubble({ state, side, text, skin: this.options.skin() });
    this.bubble = { window, state, side };
    this.bubbleReady = false;
    window.setIgnoreMouseEvents(true);
    window.setBounds(bounds);
    let shown = false;
    const show = () => {
      if (shown || window.isDestroyed() || this.bubble?.window !== window) return;
      shown = true;
      this.bubbleReady = true;
      window.showInactive();
      this.pushReply();
      if (dismissAfterMs) this.dismiss = setTimeout(() => this.hideBubble(), dismissAfterMs);
    };
    // Tokens arrive while the window loads. Flush after the renderer can
    // subscribe. ready-to-show covers a load that finished before we listened.
    window.webContents.once('did-finish-load', show);
    window.once('ready-to-show', show);
    if (!window.webContents.isLoading() && window.webContents.getURL()) queueMicrotask(show);
  }

  private pushReply() {
    const bubble = this.bubble;
    if (!this.bubbleReady || !bubble || bubble.window.isDestroyed()) return;
    if (bubble.state !== 'notice') return;
    bubble.window.webContents.send('edi:bubble-text', {
      text: this.replyText,
      done: this.replyDone,
    });
  }

  private bubblePlacement(size: { width: number; height: number }, side?: BubbleSide) {
    const pet = this.options.pet.getBounds();
    const geometry = skinGeometry[this.options.skin()];
    return placeSpeechBubble(
      {
        right: mapSkinPoint(geometry, geometry.anchors.speechRight, pet),
        left: mapSkinPoint(geometry, geometry.anchors.speechLeft, pet),
      },
      size,
      floatingMargin,
      screen.getDisplayMatching(pet).workArea,
      side,
    );
  }

  // Keep the tail on the same side while dragging; the rendered shape cannot flip.
  private followPet = () => {
    const bubble = this.bubble;
    if (!bubble || bubble.window.isDestroyed()) return;
    const size = statusBubbleSize[bubble.state];
    bubble.window.setBounds(this.bubblePlacement(size, bubble.side).bounds);
  };

  private hideBubble() {
    clearTimeout(this.dismiss);
    this.bubbleReady = false;
    this.bubble?.window.destroy();
    this.bubble = undefined;
  }

  stop = () => {
    this.options.stopWork();
    this.hideBubble();
  };

  sleep = () => {
    this.hideMenu();
    this.stop();
    this.options.card.hide();
    this.options.pet.hide();
  };

  releaseListening() {
    // No submission until capture exists; a release must never start conversation.
    if (this.mode === 'push-to-talk') this.stop();
  }

  private showContent() {
    this.hideBubble();
    this.options.showContent();
  }

  menuItems(): MenuItemConstructorOptions[] {
    return [
      { label: 'Listen', click: () => this.requestListening() },
      { label: 'Show content', click: () => this.showContent() },
      { label: 'Stop', click: this.stop },
      { type: 'separator' },
      { label: 'Sleep Edi', click: this.sleep },
      { label: 'Quit Edi', click: this.options.quit },
    ];
  }

  ownsMenu(contents: Electron.WebContents) {
    return (
      this.menu !== undefined && !this.menu.isDestroyed() && this.menu.webContents === contents
    );
  }

  private hideMenu() {
    this.menu?.destroy();
    this.menu = undefined;
  }

  action(action: MenuAction) {
    this.hideMenu();
    if (action === 'conversation') this.requestListening();
    if (action === 'content') this.showContent();
    if (action === 'stop') this.stop();
    if (action === 'sleep') this.sleep();
    if (action === 'quit') this.options.quit();
  }

  /** Opens under the pointer, like a native context menu. */
  showMenu = (point?: { x: number; y: number }) => {
    this.hideMenu();
    const pet = this.options.pet.getBounds();
    // A renderer-supplied point is honoured only if it is actually on Edi's window.
    const onPet =
      point &&
      point.x >= pet.x &&
      point.x <= pet.x + pet.width &&
      point.y >= pet.y &&
      point.y <= pet.y + pet.height;
    const origin = onPet ? point : { x: pet.x + pet.width * 0.8, y: pet.y + pet.height * 0.35 };
    const menu = this.options.createMenu();
    this.menu = menu;
    menu.setBounds(
      placeContextMenu(
        origin,
        characterMenuSize,
        floatingMargin,
        screen.getDisplayMatching(pet).workArea,
      ),
    );
    menu.once('ready-to-show', () => {
      if (!menu.isDestroyed()) menu.show();
    });
    menu.on('blur', () => {
      if (this.menu === menu) this.hideMenu();
    });
  };

  dispose() {
    this.hideMenu();
    this.hideBubble();
    this.options.pet.removeListener('move', this.followPet);
  }
}
