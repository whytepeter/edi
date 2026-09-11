import { z } from 'zod';

/**
 * On-screen presentation: a reply may end with tags in screenshot
 * pixels that Edi's hand performs over the screen, then strips from the text.
 *
 *   [POINT:x,y:label]                 point at something      ([POINT:none] = nothing)
 *   [DRAW:circle:x,y,r:label]         circle it
 *   [DRAW:box:x,y,w,h:label]          box it
 *   [DRAW:arrow:x1,y1,x2,y2:label]    draw an arrow to it
 *   [DRAW:underline:x1,y1,x2,y2:label]
 *
 * Any tag may end with `:screenN` (1-based; screen 1 has the cursor). One display
 * per reply: actions for other screens than the first action's are dropped.
 */
export const maxPresentationActions = 6;

const coordinate = z.number().finite().min(-20_000).max(20_000);
const label = z.string().max(60);
export const presentationActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('point'), x: coordinate, y: coordinate, label }).strict(),
  z
    .object({
      type: z.literal('circle'),
      x: coordinate,
      y: coordinate,
      r: z.number().positive().max(4000),
      label,
    })
    .strict(),
  z
    .object({
      type: z.literal('box'),
      x: coordinate,
      y: coordinate,
      w: z.number().positive().max(20_000),
      h: z.number().positive().max(20_000),
      label,
    })
    .strict(),
  z
    .object({
      type: z.enum(['arrow', 'underline']),
      x1: coordinate,
      y1: coordinate,
      x2: coordinate,
      y2: coordinate,
      label,
    })
    .strict(),
]);
export type PresentationAction = z.infer<typeof presentationActionSchema>;
export const presentationScriptSchema = z
  .array(presentationActionSchema)
  .min(1)
  .max(maxPresentationActions);

const tag = /\[(POINT|DRAW):([^\]]{1,200})\]/gi;
const numbers = (text: string, count: number) => {
  if (!/^\s*\d+(\s*,\s*\d+)*\s*$/.test(text)) return null;
  const values = text.split(',').map(value => Number(value.trim()));
  return values.length === count && values.every(value => Number.isInteger(value) && value >= 0)
    ? values
    : null;
};

const labelFrom = (parts: string[], start: number) =>
  parts.slice(start).join(':').trim().slice(0, 60);

function parseTag(
  kind: string,
  inner: string,
): { action: PresentationAction; screen: number } | null {
  // Only the label may contain colons, so parts are trimmed individually except it.
  const parts = inner.split(':');
  const screenPart = /^\s*screen(\d)\s*$/i.exec(parts.at(-1) ?? '');
  const screen = screenPart ? Number(screenPart[1]) : 1;
  if (screenPart) parts.pop();
  if (kind === 'POINT') {
    const at = numbers(parts[0] ?? '', 2);
    if (!at) return null;
    return {
      action: { type: 'point', x: at[0], y: at[1], label: labelFrom(parts, 1) },
      screen,
    };
  }
  const shape = (parts[0] ?? '').trim().toLowerCase();
  const text = labelFrom(parts, 2);
  if (shape === 'circle') {
    const v = numbers(parts[1] ?? '', 3);
    return v && v[2] > 0
      ? { action: { type: 'circle', x: v[0], y: v[1], r: v[2], label: text }, screen }
      : null;
  }
  if (shape === 'box') {
    const v = numbers(parts[1] ?? '', 4);
    return v && v[2] > 0 && v[3] > 0
      ? { action: { type: 'box', x: v[0], y: v[1], w: v[2], h: v[3], label: text }, screen }
      : null;
  }
  if (shape === 'arrow' || shape === 'underline') {
    const v = numbers(parts[1] ?? '', 4);
    return v
      ? { action: { type: shape, x1: v[0], y1: v[1], x2: v[2], y2: v[3], label: text }, screen }
      : null;
  }
  return null;
}

/** The reply without tags, and the actions to perform (screenshot pixels) on one screen. */
export function parsePresentation(reply: string): {
  text: string;
  screen: number;
  actions: PresentationAction[];
} {
  const parsed = [...reply.matchAll(tag)]
    .map(match => parseTag(match[1].toUpperCase(), match[2]))
    .filter(entry => entry !== null)
    .filter(
      entry =>
        entry.screen >= 1 &&
        entry.screen <= 4 &&
        presentationActionSchema.safeParse(entry.action).success,
    );
  const screen = parsed[0]?.screen ?? 1;
  const actions = parsed
    .filter(entry => entry.screen === screen)
    .map(entry => entry.action)
    .slice(0, maxPresentationActions);
  return { text: reply.replace(tag, '').trimEnd(), screen, actions };
}

type Rect = { x: number; y: number; width: number; height: number };

/**
 * Map actions from a screenshot's pixels onto its display's logical coordinates.
 * Returns null if the screen was not sent or an action falls outside the image.
 */
export function resolvePresentation(
  presentation: { screen: number; actions: PresentationAction[] },
  screenshots: readonly { width: number; height: number; display: Rect }[],
): { display: Rect; actions: PresentationAction[] } | null {
  const shot = screenshots[presentation.screen - 1];
  if (
    !shot ||
    !presentationScriptSchema.safeParse(presentation.actions).success ||
    ![shot.width, shot.height, shot.display.width, shot.display.height].every(
      n => Number.isFinite(n) && n > 0,
    )
  )
    return null;
  const sx = shot.display.width / shot.width;
  const sy = shot.display.height / shot.height;
  const inImage = (x: number, y: number) => x >= 0 && y >= 0 && x <= shot.width && y <= shot.height;
  // Same arithmetic as screenshotPointToScreen, so both round identically.
  const X = (x: number) => Math.round(shot.display.x + (x / shot.width) * shot.display.width);
  const Y = (y: number) => Math.round(shot.display.y + (y / shot.height) * shot.display.height);
  const actions: PresentationAction[] = [];
  for (const action of presentation.actions) {
    if (action.type === 'point') {
      if (!inImage(action.x, action.y)) return null;
      actions.push({ ...action, x: X(action.x), y: Y(action.y) });
    } else if (action.type === 'circle') {
      if (
        !inImage(action.x - action.r, action.y - action.r) ||
        !inImage(action.x + action.r, action.y + action.r)
      )
        return null;
      actions.push({
        ...action,
        x: X(action.x),
        y: Y(action.y),
        r: Math.round((action.r * (sx + sy)) / 2),
      });
    } else if (action.type === 'box') {
      if (!inImage(action.x, action.y) || !inImage(action.x + action.w, action.y + action.h))
        return null;
      actions.push({
        ...action,
        x: X(action.x),
        y: Y(action.y),
        w: Math.round(action.w * sx),
        h: Math.round(action.h * sy),
      });
    } else {
      if (!inImage(action.x1, action.y1) || !inImage(action.x2, action.y2)) return null;
      actions.push({
        ...action,
        x1: X(action.x1),
        y1: Y(action.y1),
        x2: X(action.x2),
        y2: Y(action.y2),
      });
    }
  }
  return { display: shot.display, actions };
}

/** Hide complete tags and an unfinished trailing tag while tokens are arriving. */
export function presentationText(reply: string): string {
  return reply
    .replace(tag, '')
    .replace(/\[(?:P(?:O(?:I(?:N(?:T)?)?)?)?|D(?:R(?:A(?:W)?)?)?)(?::[^\]]*)?$/i, '')
    .trimEnd();
}

/** Shift actions into a window whose top-left is `origin` (overlay-local pixels). */
export function localizeActions(actions: PresentationAction[], origin: { x: number; y: number }) {
  return actions.map((action): PresentationAction => {
    if (action.type === 'point' || action.type === 'circle' || action.type === 'box') {
      return { ...action, x: action.x - origin.x, y: action.y - origin.y };
    }
    return {
      ...action,
      x1: action.x1 - origin.x,
      y1: action.y1 - origin.y,
      x2: action.x2 - origin.x,
      y2: action.y2 - origin.y,
    };
  });
}
