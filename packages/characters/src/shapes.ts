/** Helpers for drawing symmetric faces in the 160-wide artboard. */

export type Side = 'left' | 'right';
export const sides: readonly Side[] = ['left', 'right'];

/** The same x on the other half of the face. */
export const mirrorX = (x: number, which: Side) => (which === 'left' ? x : 160 - x);

/** A path drawn for the left half, flipped to the right half by mirroring every x. */
export function side(path: string, which: Side) {
  if (which === 'left') return path;
  return path.replace(
    /(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g,
    (_, x: string, y: string) => `${+(160 - Number(x)).toFixed(2)} ${y}`,
  );
}

/** A rotation for the left half, mirrored (angle and center) for the right half. */
export const turn = (degrees: number, cx: number, cy: number, which: Side) =>
  `rotate(${which === 'left' ? degrees : -degrees} ${mirrorX(cx, which)} ${cy})`;
