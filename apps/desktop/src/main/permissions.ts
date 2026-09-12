import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { systemPreferences } from 'electron';
import type { AgentState } from '@edi/contracts';

export type ScreenAccess = NonNullable<AgentState['screenAccess']>;
/** Unpinned cards hide on blur, except while a system permission ask is up. */
export function shouldHideCardOnBlur(pinned: boolean, holdingForPermission: boolean): boolean {
  return !pinned && !holdingForPermission;
}

const ASK_SHEET_MS = 800;
const CAPTURE_POLL_MS = 50;
const CAPTURE_WAIT_MS = 8_000;

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
