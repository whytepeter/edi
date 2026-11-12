import { type BrowserWindow, screen, type MenuItemConstructorOptions } from 'electron';
import {
  mapSkinPoint,
  placeContextMenu,
  placeSpeechBubble,
  type ApprovalRequest,
  type ArtifactSummary,
  type BubbleReply,
  type BubbleSide,
  type CharacterExpression,
  type CharacterManifest,
  type StatusBubbleState,
  type Suggestion,
} from '@edi/contracts';
import {
  characterMenuSize,
  floatingMargin,
  replyBubbleSize,
  statusBubbleSize,
  thinkingBubbleSize,
  type StatusBubbleOptions,
} from '../windows/factory';

interface CharacterActionsOptions {
  pet: BrowserWindow;
  card: BrowserWindow;
  /** The current character: its geometry places bubbles, its accent colors them. */
  character: () => CharacterManifest;
  /** The companion's current name, for menus and bubbles. */
  name: () => string;
  /** Start real capture; false means the local voice runtime is unavailable. */
  startVoice: (mode: 'conversation' | 'push-to-talk') => boolean;
  showContent: () => void;
  openSettings: () => void;
  stopWork: () => void;
  createBubble: (options: StatusBubbleOptions) => BrowserWindow;
  createMenu: (name: string) => BrowserWindow;
  /** Narrow main-to-renderer state channel; artwork remains renderer-owned. */
  showExpression: (expression: CharacterExpression) => void;
  /** The person did something with the character; a sleepy companion wakes up. */
  noteActivity: () => void;
  quit: () => void;
}

type MenuAction = 'content' | 'settings' | 'sleep' | 'quit' | 'dismiss';

/** How big the bubble is for a reply: a spoken answer has no field under its words. */
const replySize = (reply: BubbleReply) =>
  replyBubbleSize(reply.text, reply.progress, !reply.spoken);

/** One entry point for character clicks, menu actions and the global shortcut. */
export class CharacterActions {
  private bubble?: { window: BrowserWindow; state: StatusBubbleState; side: BubbleSide };
  /** The quiet offer the bubble is showing, until it is taken up or waved away. */
  private suggestion?: Suggestion;
  /** The thinking bubble's current progress line. */
  private bubbleText?: string;
  /** The latest progress line for running work, even while the bubble shows something else. */
  private progress?: string;
  private menu?: BrowserWindow;
  private mode: 'conversation' | 'push-to-talk' = 'conversation';
  private dismiss?: ReturnType<typeof setTimeout>;
  private bubbleReady = false;
  private approval?: ApprovalRequest;
  /** Content shown during a voice turn, waiting for its compact bubble. */
  private artifact?: ArtifactSummary;
  /** The answer the reply bubble is showing, in words. */
  private reply?: BubbleReply;
  private expression: CharacterExpression = 'idle';
  private expressionTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly options: CharacterActionsOptions) {
    options.pet.on('move', this.followPet);
  }

  /** Nothing beside the character and nothing on its face: no bubble, no menu, idle. */
  get quiet() {
    return !this.bubble && !this.menu && this.expression === 'idle';
  }

  /** What Edi is doing now, for things that must not interrupt it. */
  get currentExpression() {
    return this.expression;
  }

  requestListening = (mode: 'conversation' | 'push-to-talk' = 'conversation') => {
    this.options.noteActivity();
    this.hideMenu();
    this.mode = mode;
    this.options.stopWork();
    this.options.pet.showInactive();
    if (!this.options.startVoice(mode)) this.showStatus('unavailable', 5000);
  };

  /**
   * Mirror work with dots, plus a short progress line when the person is not watching the
   * conversation ("Searching the web"). The line updates in place; the bubble never flickers.
   */
  setThinking = (thinking: boolean, text?: string) => {
    // Kept while the bubble is busy, so a voice reply that goes quiet shows what Edi is doing.
    this.progress = thinking ? text : undefined;
    if (!thinking) {
      if (this.bubble?.state === 'thinking') this.hideBubble();
      return;
    }
    const busy = this.bubble?.state;
    if (busy === 'approval' || busy === 'speaking' || busy === 'listening') return;
    // An answer being written keeps its bubble; its progress line says what Edi is doing.
    if (busy === 'reply' && this.reply && !this.reply.done) return;
    this.showThinking(text);
  };

  /**
   * Edi's answer in words, beside the character, as it is written: the conversation without
   * opening the card. It grows with the text, shows what Edi is doing under it, and once the
   * answer is complete it lingers long enough to read (and to hear), then leaves. Open shows
   * the whole conversation; the field under it sends a reply.
   */
  showReply = (
    text: string,
    options: { progress?: string; done?: boolean; spoken?: boolean } = {},
  ) => {
    const busy = this.bubble?.state;
    // A review, the person talking, or content they can open all come before words.
    if (busy === 'approval' || busy === 'listening' || busy === 'artifact') return;
    const bubble = this.bubble;
    // Once the person has brought the field up, it stays for as long as this bubble does.
    const fieldUp = bubble?.state === 'reply' && this.reply !== undefined && !this.reply.spoken;
    const reply: BubbleReply = {
      text,
      progress: (options.progress ?? '').slice(0, 60),
      done: options.done ?? false,
      spoken: (options.spoken ?? false) && !fieldUp,
    };
    const size = replySize(reply);
    if (bubble?.state !== 'reply' || bubble.window.isDestroyed()) {
      this.reply = reply;
      this.showStatus('reply');
    } else {
      const before = this.reply;
      this.reply = reply;
      if (!before || replySize(before).height !== size.height)
        bubble.window.setBounds(this.bubblePlacement(size, bubble.side).bounds);
      this.pushApproval();
    }
    clearTimeout(this.dismiss);
    if (reply.done) {
      // Time to read it, and to hear it out when it is also spoken.
      const linger = Math.max(6_000, Math.min(30_000, 3_000 + reply.text.length * 70));
      this.dismiss = setTimeout(() => this.hideBubble(), linger);
    }
  };

  /** The person is reading or answering the reply: it stays until they send or dismiss it. */
  holdReply = () => {
    const bubble = this.bubble;
    if (bubble?.state !== 'reply') return;
    clearTimeout(this.dismiss);
    // Touching a spoken answer is how the person says they want to type back: the field appears.
    if (this.reply?.spoken && !bubble.window.isDestroyed()) {
      this.reply = { ...this.reply, spoken: false };
      bubble.window.setBounds(this.bubblePlacement(replySize(this.reply), bubble.side).bounds);
      this.pushApproval();
    }
  };

  /**
   * A short note about the answer on show ("The screen changed, so I didn’t point."): under the
   * answer when it is up, otherwise as a notice of its own. It never takes the answer away.
   */
  note = (text: string) => {
    const bubble = this.bubble;
    if (bubble?.state === 'reply' && this.reply && !bubble.window.isDestroyed()) {
      const before = this.reply;
      this.reply = { ...before, progress: text.slice(0, 60) };
      if (replySize(before).height !== replySize(this.reply).height)
        bubble.window.setBounds(this.bubblePlacement(replySize(this.reply), bubble.side).bounds);
      return this.pushApproval();
    }
    if (bubble?.state === 'approval' || bubble?.state === 'listening') return;
    this.showStatus('notice', 4000, text.slice(0, 60));
  };

  /** What the reply bubble shows, for its own window to read when it opens. */
  get openReply(): BubbleReply | null {
    return this.bubble?.state === 'reply' ? (this.reply ?? null) : null;
  }

  /**
   * Warm, brief acknowledgement when Edi is asked to do something: a small happy nod with the
   * thinking dots, which then settle into thinking. No filler words in the bubble.
   */
  acknowledge = () => {
    const busy = this.bubble?.state;
    if (busy === 'approval' || busy === 'speaking' || busy === 'listening') return;
    // Straight to thinking. A smile here read as laughing at the question.
    this.showThinking();
  };

  private showThinking(text?: string) {
    const bubble = this.bubble;
    if (bubble?.state !== 'thinking' || bubble.window.isDestroyed()) {
      this.showStatus('thinking', undefined, text);
      this.bubbleText = text;
      return;
    }
    if (this.bubbleText === text) return;
    this.bubbleText = text;
    bubble.window.setBounds(this.bubblePlacement(thinkingBubbleSize(text), bubble.side).bounds);
    if (this.bubbleReady) bubble.window.webContents.send('edi:bubble-text', text ?? '');
  }

  /** Voice session feedback: live listening, thinking, speaking, a notice, or nothing. */
  showVoiceStatus = (
    status: 'opening' | 'listening' | 'thinking' | 'speaking' | 'hidden' | { notice: string },
  ) => {
    // A review to approve and a preview of something Edi made stay up while the conversation
    // goes on: listening, thinking and speaking show on the face. In a hands-free conversation
    // the microphone reopens the moment Edi stops speaking, and the listening animation used to
    // take the bubble before the person could act. The review leaves when it is answered; the
    // preview on its own timer, or when opened.
    const waitingOnThem = this.bubble?.state === 'approval' || this.bubble?.state === 'artifact';
    if (waitingOnThem && typeof status === 'string' && status !== 'hidden') {
      this.setExpression(status === 'opening' ? 'attention' : status);
    } else if (status === 'opening') {
      this.hideBubble(false);
      this.setExpression('attention');
    } else if (status === 'hidden') {
      if (this.artifact) this.presentArtifact();
      // A reply in words leaves on its own timer, after it has been read.
      else if (
        this.bubble?.state !== 'approval' &&
        this.bubble?.state !== 'artifact' &&
        this.bubble?.state !== 'reply'
      )
        this.hideBubble();
      else if (this.bubble?.state === 'reply') this.setExpression('idle');
    } else if (typeof status === 'object') {
      // A passing notice never takes the place of a review that is waiting for an answer.
      if (this.bubble?.state !== 'approval') this.showStatus('notice', 4000, status.notice);
    }
    // While the answer is on show, speaking and thinking change the face, not the bubble.
    else if (this.bubble?.state === 'reply' && (status === 'speaking' || status === 'thinking'))
      this.setExpression(status);
    else if (status === 'thinking' && this.bubble?.state !== 'approval')
      this.showThinking(this.progress);
    else if (this.bubble?.state !== status) this.showStatus(status);
  };

  /** One quiet offer from what's in front: its line, its action, and Not now. */
  showSuggestion = (suggestion: Suggestion | null) => {
    if (!suggestion) {
      this.suggestion = undefined;
      if (this.bubble?.state === 'suggestion') this.hideBubble();
      return;
    }
    // Never over a review, a voice turn or shown content: a suggestion is the least urgent thing.
    if (this.bubble && this.bubble.state !== 'suggestion') return;
    if (this.suggestion?.key === suggestion.key && this.bubble?.state === 'suggestion') return;
    this.suggestion = suggestion;
    this.hideMenu();
    this.showStatus('suggestion', 30_000);
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
    // Something to see comes before the listening and speaking animation: in a hands-free
    // conversation the bubble goes from one to the other and is never free, so a preview that
    // waited its turn never appeared. Only a review to approve comes first.
    if (this.bubble?.state === 'approval') return;
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

  private showStatus(
    state: StatusBubbleState,
    dismissAfterMs?: number,
    text?: string,
    artifact?: ArtifactSummary,
  ) {
    // Replacing one bubble with another forgets the old one's words, not the new one's.
    const reply = state === 'reply' ? this.reply : undefined;
    this.hideBubble(false);
    this.reply = reply;
    this.setExpression(this.expressionFor(state));
    const size =
      state === 'thinking'
        ? thinkingBubbleSize(text)
        : state === 'reply' && this.reply
          ? replySize(this.reply)
          : statusBubbleSize[state];
    const { bounds, side } = this.bubblePlacement(size);
    const window = this.options.createBubble({
      state,
      side,
      text,
      artifact,
      accent: this.options.character().colors.accent,
      name: this.options.name(),
    });
    this.bubble = { window, state, side };
    this.bubbleReady = false;
    window.setIgnoreMouseEvents(
      state !== 'approval' && state !== 'artifact' && state !== 'suggestion' && state !== 'reply',
    );
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
    if (bubble.state === 'suggestion' && this.suggestion)
      return bubble.window.webContents.send('edi:bubble-suggestion', this.suggestion);
    if (bubble.state === 'reply' && this.reply)
      return bubble.window.webContents.send('edi:bubble-reply', this.reply);
    if (bubble.state !== 'approval' || !this.approval) return;
    bubble.window.webContents.send('edi:bubble-approval', this.approval);
  }

  /** The offer the bubble is showing, for its own window to read. */
  get openSuggestion(): Suggestion | null {
    return this.bubble?.state === 'suggestion' ? (this.suggestion ?? null) : null;
  }

  private bubblePlacement(size: { width: number; height: number }, side?: BubbleSide) {
    const pet = this.options.pet.getBounds();
    const geometry = this.options.character().geometry;
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
    const size =
      bubble.state === 'thinking'
        ? thinkingBubbleSize(this.bubbleText)
        : bubble.state === 'reply' && this.reply
          ? replySize(this.reply)
          : statusBubbleSize[bubble.state];
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
    this.bubbleText = undefined;
    this.reply = undefined;
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
    this.options.noteActivity();
    this.options.showContent();
    // Let an approval bubble's IPC reply complete before destroying its sender.
    const bubble = this.bubble?.window;
    setTimeout(() => {
      if (bubble && this.bubble?.window === bubble) this.hideBubble();
    }, 0);
  };

  menuItems(): MenuItemConstructorOptions[] {
    const name = this.options.name();
    return [
      { label: 'Listen', click: () => this.requestListening() },
      { label: `Open ${name}`, click: () => this.showContent() },
      { label: 'Settings…', accelerator: 'CommandOrControl+,', click: this.options.openSettings },
      { label: 'Stop', click: this.stop },
      { type: 'separator' },
      { label: `Sleep ${name}`, click: this.sleep },
      { label: `Quit ${name}`, click: this.options.quit },
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
    const menu = this.options.createMenu(this.options.name());
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
