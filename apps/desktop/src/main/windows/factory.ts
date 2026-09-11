import { BrowserWindow, screen, type BrowserWindowConstructorOptions } from 'electron';
import { join } from 'node:path';
import {
  clampWindow,
  desktopPetSize,
  type BubbleSide,
  type SkinId,
  type StatusBubbleState,
} from '@edi/contracts';

/** Renderer entry points. One bundle serves all of them, selected by `?surface=`. */
export type Surface = 'workspace' | 'pet' | 'voice-status' | 'character-menu' | 'pointer';

export const cardSize = {
  compact: { width: 408, height: 480 },
  expanded: { width: 740, height: 650 },
} as const;

/** Transparent inset around bubbles and menus so their soft shadows are not clipped. */
export const floatingMargin = 8;

/** Window sizes include `floatingMargin` on every side. */
export const statusBubbleSize: Record<StatusBubbleState, { width: number; height: number }> = {
  unavailable: { width: 160, height: 52 },
  thinking: { width: 88, height: 52 },
  listening: { width: 92, height: 52 },
  notice: { width: 340, height: 184 },
};
export const characterMenuSize = { width: 200, height: 178 } as const;

const isolated = { contextIsolation: true, sandbox: true, nodeIntegration: false } as const;
const withBridge = { ...isolated, preload: join(__dirname, '../preload/index.js') };
const floating: BrowserWindowConstructorOptions = {
  show: false,
  transparent: true,
  frame: false,
  resizable: false,
  alwaysOnTop: true,
};

function loadSurface(win: BrowserWindow, surface: Surface, params: Record<string, string> = {}) {
  const query = { surface, ...params };
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/?${new URLSearchParams(query)}`);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { query });
  }
  return win;
}

export function createWorkspaceWindow() {
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea;
  const win = new BrowserWindow({
    ...floating,
    width: Math.min(cardSize.compact.width, width),
    height: Math.min(cardSize.compact.height, height),
    x: x + Math.max(0, width - 550),
    y: y + Math.max(0, height - 540),
    title: 'Edi',
    backgroundColor: '#00000000',
    hasShadow: true,
    webPreferences: withBridge,
  });
  return loadSurface(win, 'workspace');
}

export function createPetWindow(saved: { x: number; y: number } | null) {
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea;
  const win = new BrowserWindow({
    ...floating,
    ...desktopPetSize,
    x: x + width - desktopPetSize.width - 20,
    y: y + height - desktopPetSize.height - 25,
    hasShadow: false,
    skipTaskbar: true,
    // Spoken replies start after an asynchronous turn, not inside the click handler.
    webPreferences: { ...withBridge, autoplayPolicy: 'no-user-gesture-required' },
  });
  // Transparent margins pass clicks through; the renderer re-enables hits over the body.
  win.setIgnoreMouseEvents(true, { forward: true });
  if (saved) {
    const restored = { ...saved, ...desktopPetSize };
    win.setBounds(clampWindow(restored, screen.getDisplayMatching(restored).workArea));
  }
  return loadSurface(win, 'pet');
}

export interface StatusBubbleOptions {
  state: StatusBubbleState;
  side: BubbleSide;
  skin: SkinId;
  /** Only for `notice`; validated again by the renderer. */
  text?: string;
}

export function createStatusBubbleWindow({ state, side, skin, text }: StatusBubbleOptions) {
  const win = new BrowserWindow({
    ...floating,
    ...statusBubbleSize[state],
    hasShadow: false,
    skipTaskbar: true,
    focusable: false,
    // Receive-only preload; no command bridge.
    webPreferences: { ...isolated, preload: join(__dirname, '../preload/bubble.js') },
  });
  return loadSurface(win, 'voice-status', { state, side, skin, ...(text ? { text } : {}) });
}

export function createCharacterMenuWindow() {
  const win = new BrowserWindow({
    ...floating,
    ...characterMenuSize,
    hasShadow: false,
    skipTaskbar: true,
    webPreferences: withBridge,
  });
  return loadSurface(win, 'character-menu');
}

/**
 * A transparent layer over one whole display for Edi's pointer. It never takes
 * focus or clicks (every event passes through to the apps beneath) and has no
 * bridge: it only draws what main put in its URL.
 */
export function createPointerWindow(
  display: { x: number; y: number; width: number; height: number },
  params: Record<string, string>,
) {
  const win = new BrowserWindow({
    ...floating,
    ...display,
    hasShadow: false,
    skipTaskbar: true,
    focusable: false,
    enableLargerThanScreen: true,
    webPreferences: isolated,
  });
  win.setIgnoreMouseEvents(true);
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  return loadSurface(win, 'pointer', params);
}

export function broadcast(windows: BrowserWindow[], channel: string, value: unknown) {
  for (const win of windows) if (!win.isDestroyed()) win.webContents.send(channel, value);
}
