import { z } from 'zod';
import type { PresentationAction } from './presentation';

/**
 * Text recognized on a screenshot, on this Mac, from the full-resolution capture.
 * Boxes are normalized to the image, top-left origin: [x, y, width, height].
 * It stays in main for the run: it is never sent to a provider or stored.
 */
const unit = z.number().finite().min(-0.01).max(1.01);
const box = z.tuple([unit, unit, unit, unit]);
export const screenTextSchema = z
  .array(
    z.object({
      t: z.string().max(1000),
      c: z.number().finite().min(0).max(1),
      b: box,
      w: z.array(z.object({ t: z.string().max(500), b: box })).max(200),
    }),
  )
  .max(1500);
export type ScreenText = z.infer<typeof screenTextSchema>;

type Rect = { x: number; y: number; width: number; height: number };
interface Candidate {
  text: string;
  rect: Rect;
}

/** Words in a label that describe the kind of control, not its visible text. */
const descriptive = new Set(
  [
    'a an the this that here there in on at of to for your my click press tap select choose open',
    'button buttons icon icons menu item tab tabs link field fields option options checkbox',
    'toggle switch label text title section bar area box input dropdown control',
  ]
    .join(' ')
    .split(' '),
);

const normalize = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const compact = (text: string) => normalize(text).replace(/ /g, '');

/** The part of a label that should match visible text: "the Save button" → "save". */
export function labelTarget(label: string) {
  const tokens = normalize(label).split(' ').filter(Boolean);
  const kept = tokens.filter(token => !descriptive.has(token));
  return (kept.length ? kept : tokens).join(' ');
}

/** 0–1: how well visible text matches a label's target words. */
export function textSimilarity(target: string, text: string) {
  const a = compact(target);
  const b = compact(text);
  if (a.length < 2 || !b) return 0;
  if (a === b) return 1;
  if (a.length <= 2) return 0; // "OK" must match exactly
  const left = normalize(target).split(' ');
  const right = normalize(text).split(' ');
  const shared = left.filter(token => right.includes(token)).length;
  const dice = (2 * shared) / (left.length + right.length);
  const contained = b.includes(a) ? 0.9 * Math.sqrt(a.length / b.length) : 0;
  return Math.max(dice, contained);
}

function candidates(lines: ScreenText, image: { width: number; height: number }): Candidate[] {
  const rect = ([x, y, w, h]: readonly number[]): Rect => ({
    x: (x ?? 0) * image.width,
    y: (y ?? 0) * image.height,
    width: (w ?? 0) * image.width,
    height: (h ?? 0) * image.height,
  });
  const union = (rects: Rect[]): Rect => {
    const left = Math.min(...rects.map(r => r.x));
    const top = Math.min(...rects.map(r => r.y));
    const right = Math.max(...rects.map(r => r.x + r.width));
    const bottom = Math.max(...rects.map(r => r.y + r.height));
    return { x: left, y: top, width: right - left, height: bottom - top };
  };
  const found: Candidate[] = [];
  for (const line of lines) {
    found.push({ text: line.t, rect: rect(line.b) });
    const words = line.w.map(word => ({ text: word.t, rect: rect(word.b) }));
    // Every run of up to six consecutive words, so "Save" is found inside "Save  Cancel".
    for (let start = 0; start < words.length; start++) {
      for (let end = start; end < Math.min(words.length, start + 6); end++) {
        const span = words.slice(start, end + 1);
        if (span.length === words.length) continue; // same as the line
        found.push({ text: span.map(w => w.text).join(' '), rect: union(span.map(w => w.rect)) });
      }
    }
  }
  return found.filter(c => c.rect.width > 0 && c.rect.height > 0);
}

/** Where the model aimed each action, in image pixels. */
function aimOf(action: PresentationAction) {
  switch (action.type) {
    case 'point':
    case 'circle':
    case 'ellipse':
      return { x: action.x, y: action.y };
    case 'box':
      return { x: action.x + action.w / 2, y: action.y + action.h / 2 };
    case 'arrow':
      return { x: action.x2, y: action.y2 };
    case 'underline':
      return { x: (action.x1 + action.x2) / 2, y: (action.y1 + action.y2) / 2 };
  }
}

function distanceTo(point: { x: number; y: number }, r: Rect) {
  const dx = Math.max(r.x - point.x, 0, point.x - (r.x + r.width));
  const dy = Math.max(r.y - point.y, 0, point.y - (r.y + r.height));
  return Math.hypot(dx, dy);
}

const MIN_SIMILARITY = 0.7;
/** How far from the model's aim a match may be, as a share of the image diagonal. */
const REACH = 0.12;

function fit(action: PresentationAction, r: Rect, image: { width: number; height: number }) {
  const clampX = (x: number) => Math.round(Math.min(Math.max(x, 0), image.width));
  const clampY = (y: number) => Math.round(Math.min(Math.max(y, 0), image.height));
  const pad = Math.min(Math.max(r.height * 0.35, 3), 12);
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const room = Math.max(1, Math.min(cx, cy, image.width - cx, image.height - cy));
  switch (action.type) {
    case 'point':
      return { ...action, x: clampX(cx), y: clampY(cy) };
    case 'circle':
    case 'ellipse': {
      // A circle around a wide label cuts through it; an ellipse hugs it instead.
      if (r.width / r.height > 1.6) {
        return {
          type: 'ellipse' as const,
          label: action.label,
          x: clampX(cx),
          y: clampY(cy),
          rx: Math.round(Math.min(r.width / 2 + pad * 2, image.width / 2, room * 4)),
          ry: Math.round(Math.min(r.height / 2 + pad * 1.5, room)),
        };
      }
      const radius = Math.min((Math.max(r.width, r.height) / 2) * 1.15 + pad, room);
      return {
        type: 'circle' as const,
        label: action.label,
        x: clampX(cx),
        y: clampY(cy),
        r: Math.max(1, Math.round(radius)),
      };
    }
    case 'box': {
      const x = clampX(r.x - pad);
      const y = clampY(r.y - pad);
      return {
        ...action,
        x,
        y,
        w: Math.max(1, clampX(r.x + r.width + pad) - x),
        h: Math.max(1, clampY(r.y + r.height + pad) - y),
      };
    }
    case 'underline': {
      const y = clampY(r.y + r.height + Math.max(2, pad / 2));
      return { ...action, x1: clampX(r.x), y1: y, x2: clampX(r.x + r.width), y2: y };
    }
    case 'arrow': {
      // Keep where the arrow starts; end it just outside the target, on the line toward its center.
      const dx = action.x1 - cx;
      const dy = action.y1 - cy;
      const halfW = r.width / 2 + pad;
      const halfH = r.height / 2 + pad;
      const scale = Math.min(
        dx ? halfW / Math.abs(dx) : Infinity,
        dy ? halfH / Math.abs(dy) : Infinity,
      );
      if (!Number.isFinite(scale) || scale >= 1)
        return { ...action, x2: clampX(cx), y2: clampY(cy) };
      return { ...action, x2: clampX(cx + dx * scale), y2: clampY(cy + dy * scale) };
    }
  }
}

/**
 * Snap each action onto on-screen text that matches its label near where the model aimed.
 * Models estimate pixel positions roughly; recognized text is exact. Actions without a
 * convincing nearby match are left as the model gave them.
 */
export function groundPresentation<T extends { actions: PresentationAction[] }>(
  presentation: T,
  image: { width: number; height: number },
  text: ScreenText,
): T & { grounded: number } {
  if (!text.length || image.width <= 0 || image.height <= 0)
    return { ...presentation, grounded: 0 };
  const pool = candidates(text, image);
  const reach = Math.hypot(image.width, image.height) * REACH;
  let grounded = 0;
  const actions = presentation.actions.map(action => {
    const target = labelTarget(action.label);
    if (!target) return action;
    const aim = aimOf(action);
    let best: { score: number; rect: Rect } | undefined;
    for (const candidate of pool) {
      const distance = distanceTo(aim, candidate.rect);
      if (distance > reach) continue;
      const similarity = textSimilarity(target, candidate.text);
      if (similarity < MIN_SIMILARITY) continue;
      // Prefer the closest good match; between equally close, the better text match.
      const score = similarity - 0.35 * (distance / reach);
      if (!best || score > best.score) best = { score, rect: candidate.rect };
    }
    if (!best) return action;
    grounded++;
    return fit(action, best.rect, image);
  });
  return { ...presentation, actions, grounded };
}
