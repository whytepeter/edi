/** Electron work areas and SVG mapping use logical pixels, including negative display origins. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function clampWindow(rect: Rect, area: Rect): Rect {
  for (const value of [rect, area]) {
    if (!Object.values(value).every(Number.isFinite) || value.width <= 0 || value.height <= 0)
      throw new Error('Invalid window rectangle');
  }
  const width = Math.min(rect.width, area.width);
  const height = Math.min(rect.height, area.height);
  return {
    x: Math.round(Math.max(area.x, Math.min(rect.x, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(rect.y, area.y + area.height - height))),
    width: Math.floor(width),
    height: Math.floor(height),
  };
}

/** Prefer above-left of the skin anchor; flip right when that side has room. */
export function placeCard(
  anchor: { x: number; y: number },
  size: { width: number; height: number },
  area: Rect,
): Rect {
  const gap = 12;
  const left = anchor.x - gap - size.width;
  const right = anchor.x + gap;
  const x = left >= area.x || right + size.width > area.x + area.width ? left : right;
  // A BrowserWindow bounds object may carry x/y despite the narrower size type.
  return clampWindow(
    { x, y: anchor.y - size.height, width: size.width, height: size.height },
    area,
  );
}

type Point = { x: number; y: number };
type Size = { width: number; height: number };

/**
 * Put a speech bubble's tail corner on the head anchor: up and to the right by default,
 * mirrored to the left when the right side lacks room. `margin` is the transparent
 * shadow inset around the painted bubble inside its window.
 */
export function placeSpeechBubble(
  anchors: { right: Point; left: Point },
  size: Size,
  margin: number,
  area: Rect,
  side?: 'left' | 'right',
): { bounds: Rect; side: 'left' | 'right' } {
  const right = { x: anchors.right.x - margin, y: anchors.right.y - size.height + margin };
  const chosen = side ?? (right.x + size.width <= area.x + area.width ? 'right' : 'left');
  const origin =
    chosen === 'right'
      ? right
      : { x: anchors.left.x - size.width + margin, y: anchors.left.y - size.height + margin };
  return {
    bounds: clampWindow({ ...origin, width: size.width, height: size.height }, area),
    side: chosen,
  };
}

/** Open a context menu with its visible corner at the pointer, flipping at display edges. */
export function placeContextMenu(point: Point, size: Size, margin: number, area: Rect): Rect {
  let x = point.x - margin;
  let y = point.y - margin;
  if (x + size.width > area.x + area.width) x = point.x - size.width + margin;
  if (y + size.height > area.y + area.height) y = point.y - size.height + margin;
  return clampWindow({ x, y, width: size.width, height: size.height }, area);
}
