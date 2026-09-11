import { z } from 'zod';

// Desktop size is independent of the logical artboard and appearance previews.
export const desktopPetSize = { width: 112, height: 120 } as const;

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
    anchors: z.object({ workspace: point, leftHand: point, rightHand: point }).strict(),
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
  },
};
export const skinGeometry = {
  cloud: skinGeometrySchema.parse({
    ...base,
    paintedBounds: { x: 8, y: 38, width: 146, height: 108 },
    bodyPath:
      'M31 91C31 59 51 40 79 40C109 40 131 62 131 91C131 121 109 143 80 143C50 143 31 121 31 91Z',
    decorationPath: '',
  }),
  sprout: skinGeometrySchema.parse({
    ...base,
    paintedBounds: { x: 8, y: 10, width: 146, height: 136 },
    bodyPath: 'M34 82Q30 40 80 40Q130 40 127 83L123 112Q118 142 80 143Q40 143 36 113Z',
    decorationPath:
      'M80 39C58 33 57 14 59 12C76 13 86 22 80 39ZM81 39C81 21 96 17 106 20C103 34 96 40 81 39Z',
  }),
} satisfies Record<string, SkinGeometry>;

// Local coordinates: origin is the attachment point, not the hand's center.
export const handPaths = {
  left: 'M0 0C-23 -7 -21 5 -8 14C-3 16 0 7 0 0Z',
  right: 'M0 0C22 -6 19 7 10 17C6 17 1 6 0 0Z',
};

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
