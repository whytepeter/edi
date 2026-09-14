import { BrowserWindow, screen, type BrowserWindowConstructorOptions } from 'electron';
import { join } from 'node:path';
import { shapeGlassBubble, shapeGlassWindow } from '../permissions';
import { ARTIFACT_PARTITION } from './artifact-sandbox';
import {
  clampWindow,
  mapSkinPoint,
  petWindowSize,
  skinGeometry,
  type BubbleSide,
  type ArtifactRef,
  type ArtifactSummary,
  type SkinId,
  type StatusBubbleState,
} from '@edi/contracts';

/** Renderer entry points. One bundle serves all of them, selected by `?surface=`. */
export type Surface =
  'workspace' | 'artifact' | 'pet' | 'voice-status' | 'character-menu' | 'pointer';

export const cardSize = {
  compact: { width: 408, height: 480 },
  expanded: { width: 740, height: 650 },
} as const;

/**
 * Bubbles and menus are native glass windows: macOS draws their blur, rounded corners and
 * shadow, so the window is exactly the visible surface with no transparent inset.
 */
export const floatingMargin = 0;

/** The tail band under a speech bubble; its tip is the window corner nearest Edi. */
export const bubbleTail = 5;
const withTail = (width: number, height: number) => ({ width, height: height + bubbleTail });
export const statusBubbleSize: Record<StatusBubbleState, { width: number; height: number }> = {
  unavailable: withTail(156, 36),
  thinking: withTail(72, 36),
  listening: withTail(76, 36),
  speaking: withTail(76, 36),
  notice: withTail(232, 52),
  approval: withTail(324, 204),
  artifact: withTail(292, 108),
};
export const characterMenuSize = { width: 184, height: 134 } as const;

/** The thinking bubble grows to fit a short progress line ("Searching the web"). */
export function thinkingBubbleSize(text?: string) {
  if (!text) return statusBubbleSize.thinking;
  return withTail(Math.round(Math.min(280, Math.max(112, 72 + text.length * 7.6))), 36);
}

/** Real desktop blur (CSS backdrop-filter cannot see behind a window). */
const nativeGlass = (material: 'menu' | 'popover'): Partial<BrowserWindowConstructorOptions> => ({
  vibrancy: material,
  // These windows never take focus, so keep the material active instead of greying out.
  visualEffectState: 'active',
  roundedCorners: true,
  hasShadow: true,
});

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

/** Glass windows with content are masked to this radius (CSS --radius-glass-window). */
const glassWindowRadius = 22;

export function createWorkspaceWindow() {
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea;
  const win = new BrowserWindow({
    ...floating,
    width: Math.min(cardSize.compact.width, width),
    height: Math.min(cardSize.compact.height, height),
    x: x + Math.max(0, width - 550),
    y: y + Math.max(0, height - 540),
    title: 'Edi',
    // Real glass like the artifact window: the window is the card, macOS blurs the desktop.
    ...nativeGlass('popover'),
    // Drag any edge to resize; the stretchable glass mask keeps its corners.
    resizable: true,
    minWidth: cardSize.compact.width,
    minHeight: 420,
    webPreferences: withBridge,
  });
  win.once('show', () => shapeGlassWindow(win, glassWindowRadius));
  return loadSurface(win, 'workspace');
}

/** Shown content gets its own window beside the card, like an artifact panel. */
export const artifactWindowSize = { width: 560, height: 640, minWidth: 360, minHeight: 320 };

export function createArtifactWindow(ref: ArtifactRef) {
  const win = new BrowserWindow({
    ...floating,
    // Real glass: macOS blurs and tints the desktop behind the window; the page adds only a
    // light tint and a rim, so it reads as a pane of glass rather than a blurred card.
    ...nativeGlass('popover'),
    width: artifactWindowSize.width,
    height: artifactWindowSize.height,
    minWidth: artifactWindowSize.minWidth,
    minHeight: artifactWindowSize.minHeight,
    // Documents are worth resizing; the card is not.
    resizable: true,
    title: 'Edi',
    skipTaskbar: true,
    // Its own in-memory session: interactive pages get no network and no shared storage.
    webPreferences: { ...withBridge, partition: ARTIFACT_PARTITION },
  });
  win.once('show', () => shapeGlassWindow(win, glassWindowRadius));
  return loadSurface(win, 'artifact', { ref: JSON.stringify(ref) });
}

export function createPetWindow(saved: { x: number; y: number } | null, petScale: number) {
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea;
  const size = petWindowSize(petScale);
  const win = new BrowserWindow({
    ...floating,
    ...size,
    x: x + width - size.width - 20,
    y: y + height - size.height - 25,
    hasShadow: false,
    skipTaskbar: true,
    // Spoken replies start after an asynchronous turn, not inside the click handler.
    webPreferences: { ...withBridge, autoplayPolicy: 'no-user-gesture-required' },
  });
  // Transparent margins pass clicks through; the renderer re-enables hits over the body.
  win.setIgnoreMouseEvents(true, { forward: true });
  if (saved) {
    const restored = { ...saved, ...size };
    win.setBounds(clampWindow(restored, screen.getDisplayMatching(restored).workArea));
  }
  return loadSurface(win, 'pet');
}

/**
 * Resize Edi around the point where the card attaches, so the card (and the slider in it)
 * stays still while Edi grows or shrinks. Only a display edge can force a move.
 */
export function resizePetWindow(pet: BrowserWindow, petScale: number, skin: SkinId) {
  const old = pet.getBounds();
  const size = petWindowSize(petScale);
  const geometry = skinGeometry[skin];
  const anchor = mapSkinPoint(geometry, geometry.anchors.workspace, old);
  const local = mapSkinPoint(geometry, geometry.anchors.workspace, { x: 0, y: 0, ...size });
  const next = { ...size, x: Math.round(anchor.x - local.x), y: Math.round(anchor.y - local.y) };
  pet.setBounds(clampWindow(next, screen.getDisplayMatching(old).workArea));
  return pet.getBounds();
}

export interface StatusBubbleOptions {
  state: StatusBubbleState;
  side: BubbleSide;
  skin: SkinId;
  /** The companion's name; validated again by the renderer. */
  name: string;
  /** Only for `notice`; validated again by the renderer. */
  text?: string;
  /** Only for `artifact`: the compact preview. */
  artifact?: ArtifactSummary;
}

export function createStatusBubbleWindow({
  state,
  side,
  skin,
  name,
  text,
  artifact,
}: StatusBubbleOptions) {
  const win = new BrowserWindow({
    ...floating,
    ...statusBubbleSize[state],
    ...nativeGlass('popover'),
    // The bubble mask supplies the corners; system rounding would clip the tail's tip.
    roundedCorners: false,
    skipTaskbar: true,
    focusable: state === 'approval' || state === 'artifact',
    // The preload exposes only approval response and content-reveal actions.
    webPreferences: { ...isolated, preload: join(__dirname, '../preload/bubble.js') },
  });
  // Shape once the window is on screen and its glass view has its final size.
  win.once('show', () => shapeGlassBubble(win, side, 18, bubbleTail));
  return loadSurface(win, 'voice-status', {
    state,
    side,
    skin,
    name,
    ...(text ? { text } : {}),
    ...(artifact ? { artifact: JSON.stringify(artifact) } : {}),
  });
}

export function createCharacterMenuWindow(name: string) {
  const win = new BrowserWindow({
    ...floating,
    ...characterMenuSize,
    ...nativeGlass('menu'),
    skipTaskbar: true,
    webPreferences: withBridge,
  });
  return loadSurface(win, 'character-menu', { name });
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
