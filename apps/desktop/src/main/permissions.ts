import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { systemPreferences } from 'electron';
import { screenTextSchema, type AgentState, type ScreenText } from '@edi/contracts';

export type ScreenAccess = NonNullable<AgentState['screenAccess']>;
/** Unpinned cards hide on blur, except while a system permission ask is up. */
export function shouldHideCardOnBlur(pinned: boolean, holdingForPermission: boolean): boolean {
  return !pinned && !holdingForPermission;
}

const ASK_SHEET_MS = 800;
const CAPTURE_POLL_MS = 50;
const CAPTURE_WAIT_MS = 8_000;
/** Recognition usually takes well under a second on a Retina display. */
const TEXT_WAIT_MS = 10_000;

/** Asks macOS for Screen Recording. Never a window-share picker. */
export class ScreenRecording {
  status(): ScreenAccess {
    if (macScreenCaptureGranted()) return 'granted';
    return systemPreferences.getMediaAccessStatus('screen');
  }

  async request(): Promise<ScreenAccess> {
    const access = this.status();
    if (access === 'granted') {
      return 'granted';
    }

    // macOS will not repeat a denied/restricted prompt. The permission card
    // routes those states to System Settings instead.
    if (access === 'denied' || access === 'restricted') {
      return access;
    }

    await requestMacScreenCapture();
    // CGRequest returns false while the system sheet is still up. Do not
    // treat that as a failed ask. Capture usually works only after relaunch.
    // Never call desktopCapturer.getSources here: that preflights and can
    // write a Screen Recording deny before the person has answered.
    return this.status();
  }
}

type KoffiLib = {
  func: (name: string, ret: string, args: string[]) => (...args: never[]) => unknown;
};

interface ScreenAskLibrary extends KoffiLib {
  startAsk: () => void;
  granted: () => boolean;
  startCapture: (displayId: number, maxEdge: number, quality: number) => void;
  captureState: () => number;
  lastWidth: () => number;
  lastHeight: () => number;
  lastLength: () => number;
  copyLast: (dest: Uint8Array) => void;
  textState: (key: number) => number;
  textLength: (key: number) => number;
  takeText: (key: number, dest: Uint8Array, capacity: number) => void;
  shapeBubble: (handle: bigint, radius: number, side: number, tail: number) => void;
  /** Absent in a helper built before it existed; the window then keeps system corners. */
  shapeWindow: ((handle: bigint, radius: number) => void) | null;
  /** Absent in an older helper; desktop context and Accessibility then report nothing. */
  frontContext: {
    async(
      excludePid: number,
      dest: Uint8Array,
      capacity: number,
      callback: (error: unknown, written: number) => void,
    ): void;
  } | null;
  /** Absent in an older helper; Edi then can't notice a screen share. */
  windowList: {
    async(
      dest: Uint8Array,
      capacity: number,
      callback: (error: unknown, written: number) => void,
    ): void;
  } | null;
  /** Absent in an older helper; Edi then knows where the pointer is but not what is under it. */
  elementAt: {
    async(
      x: number,
      y: number,
      dest: Uint8Array,
      capacity: number,
      callback: (error: unknown, written: number) => void,
    ): void;
  } | null;
  accessibilityTrusted: ((prompt: boolean) => boolean) | null;
  /** Absent in an older helper; Reminders and Calendar are then unavailable. */
  eventKit: {
    status: (entity: number) => number;
    request: { async(...args: unknown[]): void };
    run: { async(...args: unknown[]): void };
  } | null;
  /** Absent in an older helper; PDFs and images are then not readable. */
  documentText: {
    async(
      path: string,
      maxPages: number,
      dest: Uint8Array,
      capacity: number,
      callback: (error: unknown, written: number) => void,
    ): void;
  } | null;
}

let screenAsk: ScreenAskLibrary | null | undefined;

function loadBoundScreenAsk(): ScreenAskLibrary | null {
  if (screenAsk !== undefined) return screenAsk;
  if (process.platform !== 'darwin') {
    screenAsk = null;
    return screenAsk;
  }
  try {
    const koffi = createRequire(import.meta.url)('koffi') as { load: (path: string) => KoffiLib };
    const loaded = loadScreenAskLibrary(koffi.load);
    if (!loaded) {
      screenAsk = null;
      return screenAsk;
    }
    screenAsk = {
      ...loaded,
      startAsk: loaded.func('edi_start_screen_capture_ask', 'void', []) as () => void,
      granted: loaded.func('edi_screen_capture_granted', 'bool', []) as () => boolean,
      startCapture: loaded.func('edi_start_display_capture', 'void', [
        'uint32',
        'int',
        'int',
      ]) as ScreenAskLibrary['startCapture'],
      captureState: loaded.func('edi_display_capture_state', 'int', []) as () => number,
      lastWidth: loaded.func('edi_last_capture_width', 'int', []) as () => number,
      lastHeight: loaded.func('edi_last_capture_height', 'int', []) as () => number,
      lastLength: loaded.func('edi_last_capture_length', 'int', []) as () => number,
      copyLast: loaded.func('edi_copy_last_capture', 'void', ['void *']) as (
        dest: Uint8Array,
      ) => void,
      textState: loaded.func('edi_text_state', 'int', ['uint32']) as (key: number) => number,
      textLength: loaded.func('edi_text_length', 'int', ['uint32']) as (key: number) => number,
      takeText: loaded.func('edi_take_text', 'void', [
        'uint32',
        'void *',
        'int',
      ]) as ScreenAskLibrary['takeText'],
      shapeBubble: loaded.func('edi_shape_glass_bubble', 'void', [
        'uint64',
        'double',
        'int',
        'double',
      ]) as ScreenAskLibrary['shapeBubble'],
      frontContext: (() => {
        try {
          return loaded.func('edi_front_context', 'int', [
            'int',
            'void *',
            'int',
          ]) as unknown as NonNullable<ScreenAskLibrary['frontContext']>;
        } catch {
          return null;
        }
      })(),
      windowList: (() => {
        try {
          return loaded.func('edi_window_list', 'int', ['void *', 'int']) as unknown as NonNullable<
            ScreenAskLibrary['windowList']
          >;
        } catch {
          return null;
        }
      })(),
      elementAt: (() => {
        try {
          return loaded.func('edi_element_at', 'int', [
            'double',
            'double',
            'void *',
            'int',
          ]) as unknown as NonNullable<ScreenAskLibrary['elementAt']>;
        } catch {
          return null;
        }
      })(),
      accessibilityTrusted: (() => {
        try {
          return loaded.func('edi_accessibility_trusted', 'bool', ['bool']) as NonNullable<
            ScreenAskLibrary['accessibilityTrusted']
          >;
        } catch {
          return null;
        }
      })(),
      eventKit: (() => {
        try {
          return {
            status: loaded.func('edi_eventkit_status', 'int', ['int']) as (
              entity: number,
            ) => number,
            request: loaded.func('edi_eventkit_request', 'bool', ['int']) as unknown as {
              async(...args: unknown[]): void;
            },
            run: loaded.func('edi_eventkit_run', 'int', ['str', 'void *', 'int']) as unknown as {
              async(...args: unknown[]): void;
            },
          };
        } catch {
          return null;
        }
      })(),
      documentText: (() => {
        try {
          return loaded.func('edi_document_text', 'int', [
            'str',
            'int',
            'void *',
            'int',
          ]) as unknown as NonNullable<ScreenAskLibrary['documentText']>;
        } catch {
          return null;
        }
      })(),
      shapeWindow: (() => {
        try {
          return loaded.func('edi_shape_glass_window', 'void', ['uint64', 'double']) as NonNullable<
            ScreenAskLibrary['shapeWindow']
          >;
        } catch {
          return null;
        }
      })(),
    };
    return screenAsk;
  } catch (error) {
    console.error('Screen Recording library missing', error);
    screenAsk = null;
    return screenAsk;
  }
}

export function macScreenCaptureGranted(): boolean {
  if (process.platform !== 'darwin') return false;
  const lib = loadBoundScreenAsk();
  if (lib) return lib.granted();
  try {
    const koffi = createRequire(import.meta.url)('koffi') as { load: (path: string) => KoffiLib };
    const core = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics');
    return Boolean(core.func('CGPreflightScreenCaptureAccess', 'bool', [])());
  } catch {
    return false;
  }
}

/** Runs in this process so macOS lists Edi, not a helper. Never blocks the main thread. */
export async function requestMacScreenCapture(): Promise<boolean | 'unavailable'> {
  if (process.platform !== 'darwin') return 'unavailable';
  try {
    const lib = loadBoundScreenAsk();
    if (lib && process.env.EDI_VOICE !== 'off') {
      lib.startAsk();
      await new Promise<void>(resolve => {
        setTimeout(resolve, ASK_SHEET_MS);
      });
      return lib.granted();
    }
    const koffi = createRequire(import.meta.url)('koffi') as { load: (path: string) => KoffiLib };
    const core = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics');
    return Boolean(core.func('CGRequestScreenCaptureAccess', 'bool', [])());
  } catch (error) {
    console.error('Screen Recording request failed', error);
    return 'unavailable';
  }
}

export interface NativeScreenshot {
  jpeg: Uint8Array;
  width: number;
  height: number;
}

/** One still of a display. Empty when Screen Recording is off or capture fails. */
export async function captureDisplayJpeg(
  displayId: number,
  maxEdge: number,
  quality: number,
): Promise<NativeScreenshot | undefined> {
  const lib = loadBoundScreenAsk();
  if (!lib) return undefined;
  lib.startCapture(displayId >>> 0, maxEdge, quality);
  const deadline = Date.now() + CAPTURE_WAIT_MS;
  while (lib.captureState() === 1 && Date.now() < deadline) {
    await new Promise<void>(resolve => {
      setTimeout(resolve, CAPTURE_POLL_MS);
    });
  }
  if (lib.captureState() !== 2) return undefined;
  const length = lib.lastLength();
  const width = lib.lastWidth();
  const height = lib.lastHeight();
  if (length <= 0 || width <= 0 || height <= 0) return undefined;
  const jpeg = Buffer.alloc(length);
  lib.copyLast(jpeg);
  return { jpeg: new Uint8Array(jpeg), width, height };
}

/**
 * Text recognized on this Mac from the display's last full-resolution capture, used only to
 * align Edi's pointer. Read once, then dropped by the native side. Undefined if unavailable.
 */
export async function recognizedDisplayText(displayId: number): Promise<ScreenText | undefined> {
  const lib = loadBoundScreenAsk();
  if (!lib) return undefined;
  const key = displayId >>> 0;
  const deadline = Date.now() + TEXT_WAIT_MS;
  while (lib.textState(key) === 1 && Date.now() < deadline) {
    await new Promise<void>(resolve => {
      setTimeout(resolve, CAPTURE_POLL_MS);
    });
  }
  if (lib.textState(key) !== 2) return undefined;
  const bytes = new Uint8Array(lib.textLength(key));
  lib.takeText(key, bytes, bytes.length);
  try {
    return screenTextSchema.parse(JSON.parse(Buffer.from(bytes).toString('utf8')));
  } catch {
    return undefined;
  }
}

/**
 * Give a native-glass window a speech-bubble silhouette with its tail in the corner nearest
 * Edi. Without the native library the window keeps its plain rounded glass.
 */
export function shapeGlassBubble(
  window: { getNativeWindowHandle(): Buffer },
  side: 'left' | 'right',
  radius: number,
  tail: number,
) {
  const lib = loadBoundScreenAsk();
  if (!lib) return;
  try {
    lib.shapeBubble(
      window.getNativeWindowHandle().readBigUInt64LE(0),
      radius,
      side === 'right' ? 1 : -1,
      tail,
    );
  } catch {
    // Cosmetic only; the bubble still works as rounded glass.
  }
}

/**
 * Round a resizable native-glass window (the artifact window) with a stretchable mask, so its
 * corners match Edi's card. Without the native library it keeps the system's rounded corners.
 */
export function shapeGlassWindow(window: { getNativeWindowHandle(): Buffer }, radius: number) {
  const lib = loadBoundScreenAsk();
  if (!lib?.shapeWindow) return;
  try {
    lib.shapeWindow(window.getNativeWindowHandle().readBigUInt64LE(0), radius);
  } catch {
    // Cosmetic only.
  }
}

function loadScreenAskLibrary(load: (path: string) => KoffiLib): KoffiLib | undefined {
  for (const path of screenAskLibraryPaths()) {
    if (!existsSync(path)) continue;
    return load(path);
  }
  return undefined;
}

function screenAskLibraryPaths() {
  const name = 'libedi_screen_ask.dylib';
  return [
    join(process.resourcesPath, name),
    join(__dirname, name),
    join(__dirname, '../../build', name),
    join(__dirname, '../../../native/screen-capture/build', name),
    join(process.cwd(), '../native/screen-capture/build', name),
    join(process.cwd(), 'native/screen-capture/build', name),
  ];
}

/** Accessibility, used for selected text and the focused window's document. `prompt` asks macOS. */
export function macAccessibilityTrusted(prompt = false): boolean | 'unavailable' {
  const lib = loadBoundScreenAsk();
  if (!lib?.accessibilityTrusted) return 'unavailable';
  try {
    return lib.accessibilityTrusted(prompt);
  } catch {
    return 'unavailable';
  }
}

/** Text of a PDF (up to 50 pages, scans recognized) or an image; null when unavailable. */
export function documentText(path: string): Promise<string | null> | undefined {
  const lib = loadBoundScreenAsk();
  if (!lib?.documentText) return undefined;
  const buffer = Buffer.alloc(2 * 1024 * 1024);
  return new Promise(resolve => {
    try {
      lib.documentText!.async(path, 50, buffer, buffer.length, (error, written) => {
        resolve(error || written < 0 ? null : buffer.subarray(0, written).toString('utf8'));
      });
    } catch {
      resolve(null);
    }
  });
}

/** EventKit for Reminders and Calendar; entity 0 is events, 1 reminders. Null without the helper. */
export function eventKit() {
  const lib = loadBoundScreenAsk();
  if (!lib?.eventKit) return null;
  const { status, request, run } = lib.eventKit;
  const call = <T>(fn: { async(...args: unknown[]): void }, ...args: unknown[]) =>
    new Promise<T>((resolve, reject) =>
      fn.async(...args, (error: unknown, value: T) => (error ? reject(error) : resolve(value))),
    );
  return {
    status: (entity: 0 | 1) => status(entity),
    request: (entity: 0 | 1) => call<boolean>(request, entity),
    async run(request: object): Promise<unknown> {
      const buffer = Buffer.alloc(4 * 1024 * 1024);
      const written = await call<number>(run, JSON.stringify(request), buffer, buffer.length);
      if (written < 0) throw new Error('Edi couldn’t read that from EventKit.');
      const { result } = JSON.parse(buffer.subarray(0, written).toString('utf8')) as {
        result: unknown;
      };
      if (result && typeof result === 'object' && 'error' in result)
        throw new Error(String((result as { error: unknown }).error));
      return result;
    },
  };
}

/**
 * Raw JSON for whatever sits under a point on screen (the person's own pointer), or null when
 * the helper is older or Accessibility isn't granted. Runs off the main thread.
 */
export function elementAtPointJson(x: number, y: number): Promise<string | null> {
  const lib = loadBoundScreenAsk();
  if (!lib?.elementAt) return Promise.resolve(null);
  const buffer = Buffer.alloc(8 * 1024);
  return new Promise(resolve => {
    try {
      lib.elementAt!.async(x, y, buffer, buffer.length, (error, written) => {
        resolve(!error && written > 0 ? buffer.subarray(0, written).toString('utf8') : null);
      });
    } catch {
      resolve(null);
    }
  });
}

/** Raw JSON of the windows on screen (owner, bundle id, title), or null. Off the main thread. */
export function windowListJson(): Promise<string | null> {
  const lib = loadBoundScreenAsk();
  if (!lib?.windowList) return Promise.resolve(null);
  const buffer = Buffer.alloc(256 * 1024);
  return new Promise(resolve => {
    try {
      lib.windowList!.async(buffer, buffer.length, (error, written) => {
        resolve(!error && written > 0 ? buffer.subarray(0, written).toString('utf8') : null);
      });
    } catch {
      resolve(null);
    }
  });
}

/** Raw JSON describing the front window that is not Edi's, or null. Runs off the main thread. */
export function frontWindowContextJson(excludePid: number): Promise<string | null> {
  const lib = loadBoundScreenAsk();
  if (!lib?.frontContext) return Promise.resolve(null);
  const buffer = Buffer.alloc(64 * 1024);
  return new Promise(resolve => {
    try {
      lib.frontContext!.async(excludePid, buffer, buffer.length, (error, written) => {
        resolve(!error && written > 0 ? buffer.subarray(0, written).toString('utf8') : null);
      });
    } catch {
      resolve(null);
    }
  });
}
