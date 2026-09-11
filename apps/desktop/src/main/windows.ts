import { BrowserWindow, screen, type BrowserWindowConstructorOptions } from 'electron';
import { join } from 'node:path';
import { clampWindow, desktopPetSize } from '@edi/contracts';

/** Renderer entry points. One bundle serves all of them, selected by `?surface=`. */
export type Surface = 'workspace' | 'pet' | 'voice-status' | 'character-menu';

export const cardSize = {
  compact: { width: 408, height: 480 },
  expanded: { width: 740, height: 650 },
} as const;

const isolated = { contextIsolation: true, sandbox: true, nodeIntegration: false } as const;
const withBridge = { ...isolated, preload: join(__dirname, '../preload/index.js') };
const floating: BrowserWindowConstructorOptions = {
  show: false,
  transparent: true,
  frame: false,
  resizable: false,
  alwaysOnTop: true,
};

function loadSurface(win: BrowserWindow, surface: Surface) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/?surface=${surface}`);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { query: { surface } });
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
    webPreferences: withBridge,
  });
  // Transparent margins pass clicks through; the renderer re-enables hits over the body.
  win.setIgnoreMouseEvents(true, { forward: true });
  if (saved) {
    const restored = { ...saved, ...desktopPetSize };
    win.setBounds(clampWindow(restored, screen.getDisplayMatching(restored).workArea));
  }
  return loadSurface(win, 'pet');
}

export function createVoiceStatusWindow() {
  const win = new BrowserWindow({
    ...floating,
    width: 162,
    height: 48,
    hasShadow: false,
    skipTaskbar: true,
    focusable: false,
    // Display only: no preload, so this surface cannot send commands.
    webPreferences: isolated,
  });
  return loadSurface(win, 'voice-status');
}

export function createCharacterMenuWindow() {
  const win = new BrowserWindow({
    ...floating,
    width: 260,
    height: 276,
    hasShadow: false,
    skipTaskbar: true,
    webPreferences: withBridge,
  });
  return loadSurface(win, 'character-menu');
}

export function broadcast(windows: BrowserWindow[], channel: string, value: unknown) {
  for (const win of windows) if (!win.isDestroyed()) win.webContents.send(channel, value);
}
