import { BrowserWindow, desktopCapturer, screen, systemPreferences } from 'electron';
import {
  maxScreenshots,
  screenLabel,
  screenshotJpegQuality,
  screenshotMaxEdge,
  type AgentState,
} from '@edi/contracts';

export type ScreenAccess = NonNullable<AgentState['screenAccess']>;

export interface Screenshot {
  label: string;
  jpeg: Uint8Array;
  width: number;
  height: number;
  /** Logical bounds of the display on the shared desktop, for mapping points back. */
  display: { id: number; x: number; y: number; width: number; height: number };
}

/**
 * One screenshot per display, taken now. There is no per-request prompt (the
 * heyclicky model); macOS asks for Screen Recording once. Edi's own windows are
 * hidden from the capture, and nothing here is written to disk.
 */
export async function captureScreens(): Promise<{
  screenshots: Screenshot[];
  access: ScreenAccess;
}> {
  const access = systemPreferences.getMediaAccessStatus('screen');
  if (access === 'denied' || access === 'restricted') return { screenshots: [], access };

  const own = BrowserWindow.getAllWindows().filter(win => !win.isDestroyed());
  own.forEach(win => win.setContentProtection(true));
  let sources: Electron.DesktopCapturerSource[];
  try {
    // Before permission is granted this call triggers the macOS prompt and
    // returns blank thumbnails, which are dropped below.
    sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: screenshotMaxEdge, height: screenshotMaxEdge },
    });
  } finally {
    own.filter(win => !win.isDestroyed()).forEach(win => win.setContentProtection(false));
  }

  const displays = screen.getAllDisplays();
  const cursor = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id;
  const captured = sources
    .map(source => ({
      source,
      display: displays.find(display => String(display.id) === source.display_id),
    }))
    .filter(({ source, display }) => display && !source.thumbnail.isEmpty())
    // The cursor's display first: that is usually what the person is asking about.
    .sort((a, b) => Number(b.display!.id === cursor) - Number(a.display!.id === cursor))
    .slice(0, maxScreenshots);

  const screenshots = captured.map(({ source, display }, index) => {
    const { width, height } = source.thumbnail.getSize();
    return {
      label: screenLabel(index, captured.length, display!.id === cursor, width, height),
      jpeg: new Uint8Array(source.thumbnail.toJPEG(screenshotJpegQuality)),
      width,
      height,
      display: { id: display!.id, ...display!.bounds },
    };
  });
  return { screenshots, access: systemPreferences.getMediaAccessStatus('screen') };
}
