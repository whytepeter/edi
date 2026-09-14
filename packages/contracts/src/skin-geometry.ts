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
    // Each path is also the actual SVG hit region. No second approximate hit map.
    bodyPath: z.string().min(1).max(4000),
    decorationPath: z.string().max(4000),
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

const base = {
  version: 1 as const,
  viewBox: { x: 0, y: 0, width: 160, height: 170 },
  anchors: {
    workspace: { x: 31, y: 40 },
    leftHand: { x: 30, y: 99 },
    rightHand: { x: 132, y: 112 },
    speechRight: { x: 122, y: 54 },
    speechLeft: { x: 40, y: 54 },
  },
};
export const skinGeometry = {
  // A cream dumpling with a curled tuft; small hands appear only for gestures.
  mochi: skinGeometrySchema.parse({
    ...base,
    paintedBounds: { x: 13, y: 16, width: 136, height: 133 },
    bodyPath:
      'M80 38C108 38 127 60 131 87C134 104 143 114 139 126C135 136 122 139 111 141C97 146 63 146 49 141C38 139 25 136 21 126C17 114 26 104 29 87C33 60 52 38 80 38Z',
    decorationPath:
      'M62 48C54 36 62 21 79 20C94 19 103 28 99 37C93 31 83 31 76 38C71 43 66 46 62 48ZM80 41C80 31 91 26 101 29C100 38 91 43 80 41Z',
  }),
  // A round head with full cheeks. Ears and hoop earrings sit outside it, and a hand rests
  // under the chin while thinking; resting hands keep their shared anchors for gestures.
  edi: skinGeometrySchema.parse({
    ...base,
    paintedBounds: { x: 1, y: 20, width: 158, height: 146 },
    bodyPath:
      'M80 22C116 22 140 47 141 82C142 106 135 125 121 137C109 146 95 149 80 149C65 149 51 146 39 137C25 125 18 106 19 82C20 47 44 22 80 22Z',
    decorationPath: '',
  }),
} satisfies Record<string, SkinGeometry>;

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
