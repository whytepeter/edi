import { z } from 'zod';

// Desktop size is independent of the logical artboard and appearance previews.
export const desktopPetSize = { width: 112, height: 120 } as const;

/** How big Edi appears on the desktop, as a multiple of the default. Geometry does not change. */
export const petScaleSchema = z.number().finite().min(0.6).max(1.6);
export function petWindowSize(scale: number) {
  const bounded = Math.min(1.6, Math.max(0.6, scale));
  return {
    width: Math.round(desktopPetSize.width * bounded),
    height: Math.round(desktopPetSize.height * bounded),
  };
}

const point = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();
const bounds = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().positive().finite(),
    height: z.number().positive().finite(),
  })
  .strict();
export const skinGeometrySchema = z
  .object({
    version: z.literal(1),
    viewBox: bounds,
    paintedBounds: bounds,
    // The outline you can grab and hold: the character's only hit region.
    bodyPath: z
      .string()
      .min(1)
      .max(4000)
      .regex(/^[MmLlHhVvCcSsQqTtAaZz0-9\s,.\-eE+]+$/, 'Use only SVG path commands and numbers'),
    anchors: z
      .object({
        workspace: point,
        leftHand: point,
        rightHand: point,
        // Where a speech bubble's tail corner meets the head, on each side.
        speechRight: point,
        speechLeft: point,
      })
      .strict(),
  })
  .strict()
  .superRefine((geometry, context) => {
    const box = geometry.viewBox;
    const inside = (p: { x: number; y: number }) =>
      p.x >= box.x && p.y >= box.y && p.x <= box.x + box.width && p.y <= box.y + box.height;
    for (const [name, value] of Object.entries(geometry.anchors)) {
      if (!inside(value))
        context.addIssue({
          code: 'custom',
          message: 'Anchor outside viewBox',
          path: ['anchors', name],
        });
    }
    const painted = geometry.paintedBounds;
    if (
      !inside(painted) ||
      !inside({ x: painted.x + painted.width, y: painted.y + painted.height })
    )
      context.addIssue({
        code: 'custom',
        message: 'Painted bounds outside viewBox',
        path: ['paintedBounds'],
      });
  });
export type SkinGeometry = z.infer<typeof skinGeometrySchema>;
/** A character's artboard, hit outline and anchor points. */
export const characterGeometrySchema = skinGeometrySchema;
export type CharacterGeometry = SkinGeometry;

// Local coordinates: origin is the attachment point, not the hand's center.
export const handPaths = {
  left: 'M0 0C-23 -7 -21 5 -8 14C-3 16 0 7 0 0Z',
  right: 'M0 0C22 -6 19 7 10 17C6 17 1 6 0 0Z',
};

/**
 * The right hand's fingertip in its local coordinates: the path point farthest from
 * the attachment. When the hand points or draws, this is what touches the target.
 */
export const handTip = { x: 10, y: 17 } as const;

/** Match SVG's xMidYMid meet transform. Coordinates are logical pixels, not Retina device pixels. */
export function mapSkinPoint(
  geometry: SkinGeometry,
  point: { x: number; y: number },
  viewport: { x: number; y: number; width: number; height: number },
) {
  if (
    ![viewport.x, viewport.y, viewport.width, viewport.height, point.x, point.y].every(
      Number.isFinite,
    ) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  )
    throw new Error('Invalid skin viewport or point');
  const box = geometry.viewBox;
  const scale = Math.min(viewport.width / box.width, viewport.height / box.height);
  return {
    x: viewport.x + (viewport.width - box.width * scale) / 2 + (point.x - box.x) * scale,
    y: viewport.y + (viewport.height - box.height * scale) / 2 + (point.y - box.y) * scale,
  };
}
