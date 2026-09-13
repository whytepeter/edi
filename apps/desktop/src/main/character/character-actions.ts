import { type BrowserWindow, screen, type MenuItemConstructorOptions } from 'electron';
import {
  mapSkinPoint,
  placeContextMenu,
  placeSpeechBubble,
  skinGeometry,
  type ApprovalRequest,
  type ArtifactSummary,
  type BubbleSide,
  type CharacterExpression,
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
  /** Start real capture; false means the local voice runtime is unavailable. */
  startVoice: (mode: 'conversation' | 'push-to-talk') => boolean;
  showContent: () => void;
  openSettings: () => void;
  stopWork: () => void;
  createBubble: (options: StatusBubbleOptions) => BrowserWindow;
  createMenu: () => BrowserWindow;
  /** Narrow main-to-renderer state channel; artwork remains renderer-owned. */
  showExpression: (expression: CharacterExpression) => void;
  quit: () => void;
}

type MenuAction = 'content' | 'settings' | 'sleep' | 'quit' | 'dismiss';

/** One entry point for character clicks, menu actions and the global shortcut. */
export class CharacterActions {
  private bubble?: { window: BrowserWindow; state: StatusBubbleState; side: BubbleSide };
  private menu?: BrowserWindow;
  private mode: 'conversation' | 'push-to-talk' = 'conversation';
  private dismiss?: ReturnType<typeof setTimeout>;
  private bubbleReady = false;
  private approval?: ApprovalRequest;
  /** Content shown during a voice turn, waiting for its compact bubble. */
  private artifact?: ArtifactSummary;
  private expression: CharacterExpression = 'idle';
  private expressionTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly options: CharacterActionsOptions) {
    options.pet.on('move', this.followPet);
  }

  requestListening = (mode: 'conversation' | 'push-to-talk' = 'conversation') => {
    this.hideMenu();
    this.mode = mode;
    this.options.stopWork();
    this.options.pet.showInactive();
    if (!this.options.startVoice(mode)) this.showStatus('unavailable', 5000);
  };

  /** Mirror text work with dots, but keep the conversation itself in the card. */
  setThinking = (thinking: boolean) => {
    if (
      thinking &&
      this.bubble?.state !== 'thinking' &&
      this.bubble?.state !== 'approval' &&
      this.bubble?.state !== 'speaking'
    )
      this.showStatus('thinking');
    else if (!thinking && this.bubble?.state === 'thinking') this.hideBubble();
  };

  /** Voice session feedback: live listening, thinking, speaking, a notice, or nothing. */
  showVoiceStatus = (
    status: 'opening' | 'listening' | 'thinking' | 'speaking' | 'hidden' | { notice: string },
  ) => {
    if (status === 'opening') {
      this.hideBubble(false);
      this.setExpression('attention');
    } else if (status === 'hidden') {
      if (this.artifact) this.presentArtifact();
      else if (this.bubble?.state !== 'approval' && this.bubble?.state !== 'artifact')
        this.hideBubble();
    } else if (typeof status === 'object') this.showStatus('notice', 4000, status.notice);
    else if (this.bubble?.state !== status) this.showStatus(status);
  };

  /** Compact, actionable preview; the full prepared effect stays in the content card. */
  showApproval = (approval: ApprovalRequest | null) => {
    if (!approval) {
      this.approval = undefined;
      if (this.bubble?.state === 'approval') this.hideBubble();
      return;
    }
    if (this.approval?.callId === approval.callId) return;
    this.approval = approval;
    this.hideMenu();
    this.showStatus('approval');
  };

  /**
   * Content shown during a voice turn appears as a compact bubble with Open, instead of taking
   * over the screen. Live voice states take precedence; the preview follows when they end.
   */
  showArtifact = (artifact: ArtifactSummary) => {
    this.artifact = artifact;
    const busy = this.bubble?.state;
    if (busy === 'listening' || busy === 'speaking' || busy === 'approval') return;
    this.presentArtifact();
  };

  /** The person opened or dismissed the preview. */
  clearArtifact = () => {
    this.artifact = undefined;
    if (this.bubble?.state === 'artifact') this.hideBubble();
  };

  private presentArtifact() {
    const artifact = this.artifact;
    if (!artifact) return;
    this.showStatus('artifact', 20_000, undefined, artifact);
  }

  /** A completed turn gets one restrained acknowledgement, then returns to idle. */
  showHappy = () => this.setExpression('happy', 1500);

  private showStatus(
    state: StatusBubbleState,
    dismissAfterMs?: number,
    text?: string,
    artifact?: ArtifactSummary,
  ) {
    this.hideBubble(false);
    this.setExpression(this.expressionFor(state));
    const { bounds, side } = this.bubblePlacement(statusBubbleSize[state]);
    const window = this.options.createBubble({
      state,
      side,
      text,
      artifact,
      skin: this.options.skin(),
    });
    this.bubble = { window, state, side };
    this.bubbleReady = false;
    window.setIgnoreMouseEvents(state !== 'approval' && state !== 'artifact');
    window.setBounds(bounds);
    let shown = false;
    const show = () => {
      if (shown || window.isDestroyed() || this.bubble?.window !== window) return;
      shown = true;
      this.bubbleReady = true;
      window.showInactive();
      this.pushApproval();
      if (dismissAfterMs)
        this.dismiss = setTimeout(() => {
          if (state === 'artifact') this.artifact = undefined;
          this.hideBubble();
        }, dismissAfterMs);
    };
    // Approval data may arrive while the window loads. Flush after the renderer
    // subscribes. ready-to-show covers a load that finished before we listened.
    window.webContents.once('did-finish-load', show);
    window.once('ready-to-show', show);
    if (!window.webContents.isLoading() && window.webContents.getURL()) queueMicrotask(show);
  }

  private pushApproval() {
    const bubble = this.bubble;
    if (!this.bubbleReady || !bubble || bubble.window.isDestroyed()) return;
    if (bubble.state !== 'approval' || !this.approval) return;
    bubble.window.webContents.send('edi:bubble-approval', this.approval);
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

  private expressionFor(state: StatusBubbleState): CharacterExpression {
    if (state === 'listening') return 'listening';
    if (state === 'thinking') return 'thinking';
    if (state === 'speaking') return 'speaking';
    return 'attention';
  }

  private setExpression(expression: CharacterExpression, returnToIdleAfterMs?: number) {
    clearTimeout(this.expressionTimer);
    this.expressionTimer = undefined;
    if (this.expression !== expression) {
      this.expression = expression;
      this.options.showExpression(expression);
    }
    if (returnToIdleAfterMs)
      this.expressionTimer = setTimeout(() => {
        if (this.expression === expression) this.setExpression('idle');
      }, returnToIdleAfterMs);
  }

  private hideBubble(resetExpression = true) {
    clearTimeout(this.dismiss);
    this.bubbleReady = false;
    this.bubble?.window.destroy();
    this.bubble = undefined;
    if (resetExpression && !this.approval) this.setExpression('idle');
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

  showContent = () => {
    this.options.showContent();
    // Let an approval bubble's IPC reply complete before destroying its sender.
    const bubble = this.bubble?.window;
    setTimeout(() => {
      if (bubble && this.bubble?.window === bubble) this.hideBubble();
    }, 0);
  };

  menuItems(): MenuItemConstructorOptions[] {
    return [
      { label: 'Listen', click: () => this.requestListening() },
      { label: 'Open Edi', click: () => this.showContent() },
      { label: 'Settings…', accelerator: 'CommandOrControl+,', click: this.options.openSettings },
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

  ownsBubble(contents: Electron.WebContents) {
    return (
      this.bubble !== undefined &&
      !this.bubble.window.isDestroyed() &&
      this.bubble.window.webContents === contents
    );
  }

  private hideMenu() {
    this.menu?.destroy();
    this.menu = undefined;
  }

  action(action: MenuAction) {
    this.hideMenu();
    if (action === 'content') this.showContent();
    if (action === 'settings') this.options.openSettings();
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
    clearTimeout(this.expressionTimer);
    this.hideMenu();
    this.hideBubble();
    this.options.pet.removeListener('move', this.followPet);
  }
}
