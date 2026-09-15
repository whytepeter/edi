import {
  BrowserWindow,
  desktopCapturer,
  nativeImage,
  screen,
  systemPreferences,
} from 'electron';

import {
  createScreenContextSession,
  describePointerElement,
  maxScreenshots,
  pointerCloseUp,
  pointerCloseUpLabel,
  pointerElementSchema,
  pointsAtCursor,
  privateContextApps,
  screenLabel,
  screenPointToScreenshot,
  screenshotJpegQuality,
  screenshotMaxEdge,
  type AgentState,
  type ScreenText,
} from '@edi/contracts';

import {
  captureDisplayJpeg,
  elementAtPointJson,
  macScreenCaptureGranted,
  recognizedDisplayText,
} from '../permissions';

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

/**
 * Where the person's own mouse was when they asked, so “what's this?” has a subject. Edi never
 * moves their pointer; this only says where it already is.
 */
export interface PointerContext {
  /** 1-based index into `screenshots`. */
  screen: number;
  /** In that screenshot's pixels. */
  x: number;
  y: number;
  /** A close-up of the area around it, when the question points at something. */
  closeUp?: { label: string; jpeg: Uint8Array };
  /**
   * What sits under it, when Accessibility is granted: one line naming the control, and its box
   * in the same screenshot's pixels so Edi can mark it exactly.
   */
  element?: {
    text: string;
    named: boolean;
    box?: { x: number; y: number; width: number; height: number };
  };
  /** Boxes the person drew on this screen, in the same screenshot's pixels. */
  marks?: { x: number; y: number; width: number; height: number }[];
}

export type ScreenContext = {
  screenshots: Screenshot[];
  access: ScreenAccess | null;
  pointer?: PointerContext;
};

/**
 * Shared across typed and spoken turns so a short follow-up can
 * still see the screen, and a new non-visual request cannot.
 */
const screenContext = createScreenContextSession();

/** A box the person drew on their own screen, in global logical coordinates. */
export interface ScreenMark {
  displayId: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

let marksNow: () => ScreenMark[] = () => [];
let keepVisible: () => BrowserWindow[] = () => [];

/**
 * Main tells capture about the person's own marks and the overlay that shows them. That overlay
 * is the one window Edi does not hide from the capture: the mark has to be in the picture.
 */
export function showMarksInCaptures(options: {
  marks: () => ScreenMark[];
  windows: () => BrowserWindow[];
}) {
  marksNow = options.marks;
  keepVisible = options.windows;
}

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

  // “What's this?” gets a close-up around the pointer; every screen question gets its position.
  return captureScreens({ closeUp: pointsAtCursor(prompt) });
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
export async function captureScreens(options: { closeUp?: boolean } = {}): Promise<{
  screenshots: Screenshot[];
  access: ScreenAccess;
  pointer?: PointerContext;
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

  const shown = new Set(keepVisible());
  const ownWindows = BrowserWindow.getAllWindows().filter(
    win => !win.isDestroyed() && !shown.has(win),
  );

  // Prevent Edi's own UI from appearing in screenshots.
  ownWindows.forEach(win => {
    win.setContentProtection(true);
  });

  try {
    const displays = screen.getAllDisplays();

    const cursor = screen.getCursorScreenPoint();
    const cursorDisplayId = screen.getDisplayNearestPoint(cursor).id;

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
      ...(await pointerContext(screenshots, cursor, options.closeUp === true, marksNow())),
    };
  } finally {
    ownWindows
      .filter(win => !win.isDestroyed())
      .forEach(win => {
        win.setContentProtection(false);
      });
  }
}

/**
 * The pointer in the screenshot's own pixels, plus a close-up when asked for. The close-up comes
 * from a sharper capture of that display when the native path is available, so small labels stay
 * readable; otherwise from the screenshot already taken.
 */
async function pointerContext(
  screenshots: Screenshot[],
  cursor: { x: number; y: number },
  closeUp: boolean,
  marks: ScreenMark[],
): Promise<{ pointer?: PointerContext }> {
  const index = screenshots.findIndex(
    shot =>
      cursor.x >= shot.display.x &&
      cursor.x < shot.display.x + shot.display.width &&
      cursor.y >= shot.display.y &&
      cursor.y < shot.display.y + shot.display.height,
  );
  const shot = screenshots[index];
  if (!shot) return {};
  const at = screenPointToScreenshot(cursor, shot, shot.display);
  const pointer: PointerContext = { screen: index + 1, x: at.x, y: at.y };
  const element = await pointerElement(cursor, shot);
  if (element) pointer.element = element;
  const marked = marks
    .filter(mark => mark.displayId === shot.display.id)
    .map(mark => boxInScreenshot(mark, shot));
  if (marked.length) pointer.marks = marked;
  // A mark says exactly what they mean, and the name of the control under the pointer usually
  // answers the rest: the close-up is only worth its tokens when neither did.
  if (!closeUp || marked.length > 0 || element?.named) return { pointer };

  const sharper = await captureDisplayJpeg(shot.display.id, 3000, 90).catch(() => undefined);
  const source = sharper ?? shot;
  const image = nativeImage.createFromBuffer(Buffer.from(source.jpeg));
  const size = image.getSize();
  if (size.width > 0 && size.height > 0) {
    const centre = screenPointToScreenshot(cursor, size, shot.display);
    const width = Math.min(pointerCloseUp.width, size.width);
    const height = Math.min(pointerCloseUp.height, size.height);
    const crop = image
      .crop({
        x: Math.min(Math.max(centre.x - Math.round(width / 2), 0), size.width - width),
        y: Math.min(Math.max(centre.y - Math.round(height / 2), 0), size.height - height),
        width,
        height,
      })
      .resize({ width: Math.min(width, pointerCloseUp.maxEdge), quality: 'better' });
    const cropped = crop.getSize();
    pointer.closeUp = {
      label: pointerCloseUpLabel(pointer.screen, cropped.width, cropped.height),
      jpeg: new Uint8Array(crop.toJPEG(pointerCloseUp.quality)),
    };
  }
  return { pointer };
}

/** A box in global coordinates, in one screenshot's own pixels. */
function boxInScreenshot(
  box: { x: number; y: number; width: number; height: number },
  shot: Screenshot,
) {
  const topLeft = screenPointToScreenshot(box, shot, shot.display);
  const bottomRight = screenPointToScreenshot(
    { x: box.x + box.width, y: box.y + box.height },
    shot,
    shot.display,
  );
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: Math.max(1, bottomRight.x - topLeft.x),
    height: Math.max(1, bottomRight.y - topLeft.y),
  };
}

/** The control under the pointer, named and placed in the screenshot's own pixels. */
async function pointerElement(cursor: { x: number; y: number }, shot: Screenshot) {
  const raw = await elementAtPointJson(cursor.x, cursor.y).catch(() => null);
  if (!raw) return undefined;
  let parsed;
  try {
    parsed = pointerElementSchema.safeParse(JSON.parse(raw));
  } catch {
    return undefined;
  }
  if (!parsed.success) return undefined;
  const element = parsed.data;
  // A password manager's window is never described, the same as everywhere else.
  if (element.bundleId && privateContextApps.has(element.bundleId)) return undefined;
  const text = describePointerElement(element);
  if (!text) return undefined;
  // “Named” means the helper gave something a person would recognise, not just “group”.
  const named = Boolean(element.name);
  const frame = element.frame;
  if (!frame || frame.width <= 0 || frame.height <= 0) return { text, named };
  return { text, named, box: boxInScreenshot(frame, shot) };
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
