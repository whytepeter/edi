/**
 * Screen context sent with every request: one screenshot per
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
