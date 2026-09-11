/**
 * Screen context sent with every request (heyclicky's model): one screenshot per
 * display, taken when the person asks, scaled to fit 1280×1280 and labelled so the
 * model knows which display holds the cursor. Screenshots are never stored.
 */
export const screenshotMaxEdge = 1280;
export const screenshotJpegQuality = 80;
export const maxScreenshots = 4;

export function screenLabel(
  index: number,
  count: number,
  hasCursor: boolean,
  width: number,
  height: number,
) {
  const focus = hasCursor ? ' — cursor is on this screen (primary focus)' : '';
  return `screen ${index + 1} of ${count}${focus} (image dimensions: ${width}x${height} pixels)`;
}

/**
 * Map a point in screenshot pixels (top-left origin) to global logical screen
 * coordinates. Electron uses top-left origins on every display, so no Y flip is
 * needed; only scaling and the display's offset on the shared desktop.
 */
export function screenshotPointToScreen(
  point: { x: number; y: number },
  image: { width: number; height: number },
  display: { x: number; y: number; width: number; height: number },
) {
  if (
    ![point.x, point.y, image.width, image.height].every(Number.isFinite) ||
    image.width <= 0 ||
    image.height <= 0
  ) {
    throw new Error('Invalid screenshot point');
  }
  const x = Math.min(Math.max(point.x, 0), image.width);
  const y = Math.min(Math.max(point.y, 0), image.height);
  return {
    x: Math.round(display.x + (x / image.width) * display.width),
    y: Math.round(display.y + (y / image.height) * display.height),
  };
}

export interface PointTag {
  x: number;
  y: number;
  label: string;
  /** 1-based screenshot index; screen 1 is the display with the cursor. */
  screen: number;
}

const pointTag =
  /\[POINT:\s*(none|(\d{1,5})\s*,\s*(\d{1,5})(?::([^\]:]{1,60}))?(?::screen(\d))?)\s*\]/gi;

/**
 * heyclicky's pointing convention: the reply ends with `[POINT:x,y:label]`
 * (optionally `:screenN`) in screenshot pixels, or `[POINT:none]`. Returns the
 * reply without any tags and the last point, if one was given.
 */
export function parsePointTag(reply: string): { text: string; point: PointTag | null } {
  let point: PointTag | null = null;
  for (const match of reply.matchAll(pointTag)) {
    point =
      match[1].toLowerCase() === 'none'
        ? null
        : {
            x: Number(match[2]),
            y: Number(match[3]),
            label: (match[4] ?? '').trim(),
            screen: Number(match[5] ?? 1),
          };
  }
  return { text: reply.replace(pointTag, '').trimEnd(), point };
}

/** Where a point lands on the desktop, or null if it names a screen that was not sent. */
export function resolvePointTarget(
  point: PointTag,
  screenshots: readonly {
    width: number;
    height: number;
    display: { x: number; y: number; width: number; height: number };
  }[],
) {
  const shot = screenshots[point.screen - 1];
  if (!shot || point.x > shot.width || point.y > shot.height) return null;
  return {
    ...screenshotPointToScreen(point, shot, shot.display),
    label: point.label,
    display: shot.display,
  };
}
