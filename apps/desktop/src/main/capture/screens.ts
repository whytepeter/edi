import { BrowserWindow, desktopCapturer, screen, systemPreferences } from 'electron';

import {
  createScreenContextSession,
  maxScreenshots,
  screenLabel,
  screenshotJpegQuality,
  screenshotMaxEdge,
  type AgentState,
  type ScreenText,
} from '@edi/contracts';

import { captureDisplayJpeg, macScreenCaptureGranted, recognizedDisplayText } from '../permissions';

export type ScreenAccess = NonNullable<AgentState['screenAccess']>;

export interface Screenshot {
  label: string;
  jpeg: Uint8Array;
  width: number;
  height: number;

  /**
   * Logical bounds of the display on the shared desktop,
   * for mapping points back.
   */
  display: {
    id: number;
    x: number;
    y: number;
    width: number;
    height: number;
  };

  /**
   * Text recognized locally on the full-resolution capture, for aligning the pointer.
   * Stays in main; never sent to a provider or stored.
   */
  text?: Promise<ScreenText | undefined>;
}

export type ScreenContext = {
  screenshots: Screenshot[];
  access: ScreenAccess | null;
};

/**
 * Shared across typed and spoken turns so a short follow-up can
 * still see the screen, and a new non-visual request cannot.
 */
const screenContext = createScreenContextSession();

/**
 * Generic conversation does not touch ScreenCaptureKit or allocate
 * image data unless screen context is actually needed.
 */
export function captureScreensForPrompt(prompt: string): Promise<ScreenContext> {
  if (!screenContext.decide(prompt)) {
    return Promise.resolve({
      screenshots: [],
      access: null,
    });
  }

  return captureScreens();
}

/**
 * getSources can hang on macOS until Screen Recording is toggled.
 * Don't block a conversation turn forever.
 */
const GET_SOURCES_MS = 12_000;

/**
 * One screenshot per display, taken now.
 *
 * Edi's own windows are hidden from the capture and nothing here
 * is written to disk.
 */
export async function captureScreens(): Promise<{
  screenshots: Screenshot[];
  access: ScreenAccess;
}> {
  const access = currentScreenAccess();

  // Restricted is usually MDM / parental controls, so asking again
  // cannot succeed.
  //
  // Denied / not-determined must not call getSources because that
  // preflight can write a denial without showing the system prompt.
  if (access === 'restricted') {
    return {
      screenshots: [],
      access,
    };
  }

  if (access !== 'granted' && !macScreenCaptureGranted()) {
    return {
      screenshots: [],
      access,
    };
  }

  const ownWindows = BrowserWindow.getAllWindows().filter(win => !win.isDestroyed());

  // Prevent Edi's own UI from appearing in screenshots.
  ownWindows.forEach(win => {
    win.setContentProtection(true);
  });

  try {
    const displays = screen.getAllDisplays();

    const cursorDisplayId = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id;

    // Prefer native ScreenCaptureKit.
    const native = await captureDisplaysNative(displays);

    // Fall back to Electron if native capture produced nothing.
    const captured = (native.length ? native : await captureDisplaysElectron(displays))
      // Put the display containing the cursor first.
      .sort(
        (a, b) =>
          Number(b.display.id === cursorDisplayId) - Number(a.display.id === cursorDisplayId),
      )
      .slice(0, maxScreenshots);

    const screenshots = captured.map((row, index): Screenshot => ({
      label: screenLabel(
        index,
        captured.length,
        row.display.id === cursorDisplayId,
        row.width,
        row.height,
      ),

      jpeg: row.jpeg,
      width: row.width,
      height: row.height,

      display: {
        id: row.display.id,
        ...row.display.bounds,
      },

      text: 'text' in row ? row.text : undefined,
    }));

    return {
      screenshots,
      access: currentScreenAccess(),
    };
  } finally {
    ownWindows
      .filter(win => !win.isDestroyed())
      .forEach(win => {
        win.setContentProtection(false);
      });
  }
}

function currentScreenAccess(): ScreenAccess {
  if (macScreenCaptureGranted()) {
    return 'granted';
  }

  return systemPreferences.getMediaAccessStatus('screen');
}

async function captureDisplaysNative(displays: Electron.Display[]) {
  const rows: {
    jpeg: Uint8Array;
    width: number;
    height: number;
    display: Electron.Display;
    text?: Promise<ScreenText | undefined>;
  }[] = [];

  for (const display of displays) {
    const shot = await captureDisplayJpeg(display.id, screenshotMaxEdge, screenshotJpegQuality);

    if (shot) {
      rows.push({
        ...shot,
        display,
        // Recognition continues in the background while the question is answered.
        text: recognizedDisplayText(display.id),
      });
    }
  }

  return rows;
}

async function captureDisplaysElectron(displays: Electron.Display[]) {
  const sources = await getScreenSources().catch((): Electron.DesktopCapturerSource[] => []);

  return sources
    .map((source, index) => ({
      source,
      display: matchDisplay(source, displays, index),
    }))
    .filter(
      (
        row,
      ): row is {
        source: Electron.DesktopCapturerSource;
        display: Electron.Display;
      } => Boolean(row.display && !row.source.thumbnail.isEmpty()),
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

  if (matched) {
    return matched;
  }

  // Electron sometimes leaves display_id empty.
  if (displays.length === 1) {
    return displays[0];
  }

  return displays[index];
}

function getScreenSources() {
  const request = desktopCapturer.getSources({
    types: ['screen'],

    thumbnailSize: {
      width: screenshotMaxEdge,
      height: screenshotMaxEdge,
    },
  });

  return new Promise<Electron.DesktopCapturerSource[]>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('timeout'));
    }, GET_SOURCES_MS);

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
