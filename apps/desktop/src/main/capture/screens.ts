import { BrowserWindow, desktopCapturer, screen, systemPreferences } from 'electron';
import {
  maxScreenshots,
  screenLabel,
  screenshotJpegQuality,
  screenshotMaxEdge,
  type AgentState,
} from '@edi/contracts';
import { captureDisplayJpeg, macScreenCaptureGranted } from '../permissions';

export type ScreenAccess = NonNullable<AgentState['screenAccess']>;

export interface Screenshot {
  label: string;
  jpeg: Uint8Array;
  width: number;
  height: number;
  /** Logical bounds of the display on the shared desktop, for mapping points back. */
  display: { id: number; x: number; y: number; width: number; height: number };
}

/** getSources can hang on macOS until Screen Recording is toggled. Don't block a turn. */
const GET_SOURCES_MS = 12_000;

/**
 * One screenshot per display, taken now. Edi's own windows are hidden from
 * the capture, and nothing here is written to disk.
 */
export async function captureScreens(): Promise<{
  screenshots: Screenshot[];
  access: ScreenAccess;
}> {
  const access = currentScreenAccess();
  // Restricted is MDM / parental — asking cannot succeed. Denied / not
  // determined must not call getSources: that preflight writes a deny and
  // never shows the system prompt.
  if (access === 'restricted') return { screenshots: [], access };
  if (access !== 'granted' && !macScreenCaptureGranted()) return { screenshots: [], access };

  const own = BrowserWindow.getAllWindows().filter(win => !win.isDestroyed());
  own.forEach(win => win.setContentProtection(true));
  try {
    const displays = screen.getAllDisplays();
    const cursor = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id;
    const native = await captureDisplaysNative(displays);
    const captured = (native.length ? native : await captureDisplaysElectron(displays))
      .sort((a, b) => Number(b.display.id === cursor) - Number(a.display.id === cursor))
      .slice(0, maxScreenshots);
    const screenshots = captured.map((row, index) => ({
      label: screenLabel(index, captured.length, row.display.id === cursor, row.width, row.height),
      jpeg: row.jpeg,
      width: row.width,
      height: row.height,
      display: { id: row.display.id, ...row.display.bounds },
    }));
    return { screenshots, access: currentScreenAccess() };
  } finally {
    own.filter(win => !win.isDestroyed()).forEach(win => win.setContentProtection(false));
  }
}

function currentScreenAccess(): ScreenAccess {
  if (macScreenCaptureGranted()) return 'granted';
  return systemPreferences.getMediaAccessStatus('screen');
}

async function captureDisplaysNative(displays: Electron.Display[]) {
  const rows: { jpeg: Uint8Array; width: number; height: number; display: Electron.Display }[] = [];
  for (const display of displays) {
    const shot = await captureDisplayJpeg(display.id, screenshotMaxEdge, screenshotJpegQuality);
    if (shot) rows.push({ ...shot, display });
  }
  return rows;
}

async function captureDisplaysElectron(displays: Electron.Display[]) {
  let sources: Electron.DesktopCapturerSource[] = [];
  try {
    sources = await getScreenSources();
  } catch {
    sources = [];
  }
  return sources
    .map((source, index) => ({
      source,
      display: matchDisplay(source, displays, index),
    }))
    .filter((row): row is { source: Electron.DesktopCapturerSource; display: Electron.Display } =>
      Boolean(row.display && !row.source.thumbnail.isEmpty()),
    )
    .map(({ source, display }) => {
      const { width, height } = source.thumbnail.getSize();
      return {
        jpeg: new Uint8Array(source.thumbnail.toJPEG(screenshotJpegQuality)),
        width,
        height,
        display,
      };
    });
}

function matchDisplay(
  source: Electron.DesktopCapturerSource,
  displays: Electron.Display[],
  index: number,
) {
  const matched = displays.find(display => String(display.id) === source.display_id);
  if (matched) return matched;
  // Electron sometimes leaves display_id empty; pair by order when counts match.
  if (displays.length === 1) return displays[0];
  return displays[index];
}

function getScreenSources() {
  const request = desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: screenshotMaxEdge, height: screenshotMaxEdge },
  });
  return new Promise<Electron.DesktopCapturerSource[]>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), GET_SOURCES_MS);
    request.then(
      sources => {
        clearTimeout(timer);
        resolve(sources);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
