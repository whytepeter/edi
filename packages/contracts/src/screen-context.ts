import { z } from 'zod';

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
 * A close-up of the area around the mouse pointer, sent when the person points at something and
 * says "this". Taken from the sharpest capture available, then scaled to this edge.
 */
export const pointerCloseUp = {
  /** The area around the pointer, in that capture's own pixels. */
  width: 900,
  height: 560,
  maxEdge: 900,
  quality: 80,
} as const;

/**
 * Words that mean "the thing under my mouse". A question with one of these gets the close-up;
 * the pointer's position travels with every screen question anyway.
 */
export function pointsAtCursor(prompt: string) {
  return /\b(this|that|these|those|here|there|it|its|pointing|cursor|mouse|hover(?:ing)?|highlighted|selected)\b/i.test(
    prompt,
  );
}

/**
 * What sits under the pointer, as the native helper reports it. Read only for the one element,
 * never a window's contents; a password field's value is never included.
 */
export const pointerElementSchema = z
  .object({
    kind: z.string().max(60).optional(),
    role: z.string().max(60).optional(),
    name: z.string().max(200).optional(),
    value: z.string().max(220).optional(),
    app: z.string().max(120).optional(),
    bundleId: z.string().max(200).optional(),
    frame: z
      .object({
        x: z.number().finite(),
        y: z.number().finite(),
        width: z.number().finite(),
        height: z.number().finite(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type PointerElement = z.infer<typeof pointerElementSchema>;

/** One line naming what the pointer is over: “button “Export” in Gmail”. */
export function describePointerElement(element: PointerElement) {
  const kind = (element.kind || element.role || '').replace(/^AX/, '').toLowerCase();
  const parts = [kind, element.name ? `“${element.name}”` : ''].filter(Boolean).join(' ');
  const value = element.value ? `, showing “${element.value}”` : '';
  const where = element.app ? ` in ${element.app}` : '';
  return `${parts || 'something'}${where}${value}`.slice(0, 300);
}

export function pointerCloseUpLabel(screen: number, width: number, height: number) {
  return `close-up around the mouse pointer on screen ${screen}, pointer at its centre (image dimensions: ${width}x${height} pixels)`;
}

/**
 * Map a point in global logical screen coordinates into a screenshot's pixels: the inverse of
 * `screenshotPointToScreen`, for telling the model where the mouse is.
 */
export function screenPointToScreenshot(
  point: { x: number; y: number },
  image: { width: number; height: number },
  display: { x: number; y: number; width: number; height: number },
) {
  if (
    ![point.x, point.y, image.width, image.height].every(Number.isFinite) ||
    display.width <= 0 ||
    display.height <= 0
  ) {
    throw new Error('Invalid screen point');
  }
  const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max);
  return {
    x: Math.round(clamp(((point.x - display.x) / display.width) * image.width, image.width)),
    y: Math.round(clamp(((point.y - display.y) / display.height) * image.height, image.height)),
  };
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
