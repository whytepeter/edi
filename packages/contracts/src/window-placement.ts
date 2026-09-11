/** Electron work areas and SVG mapping use logical pixels, including negative display origins. */
export interface Rect { x: number; y: number; width: number; height: number }

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
    width: Math.floor(width), height: Math.floor(height),
  };
}

/** Prefer above-left of the skin anchor; flip right when that side has room. */
export function placeCard(anchor: { x: number; y: number }, size: { width: number; height: number }, area: Rect): Rect {
  const gap = 12;
  const left = anchor.x - gap - size.width;
  const right = anchor.x + gap;
  const x = left >= area.x || right + size.width > area.x + area.width ? left : right;
  // A BrowserWindow bounds object may carry x/y despite the narrower size type.
  return clampWindow({ x, y: anchor.y - size.height, width: size.width, height: size.height }, area);
}
