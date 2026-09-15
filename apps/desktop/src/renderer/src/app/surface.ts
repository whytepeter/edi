import { z } from 'zod';
import {
  assistantNameSchema,
  artifactRefSchema,
  artifactSummarySchema,
  bubbleNoticeSchema,
  bubbleSideSchema,
  statusBubbleStateSchema,
  presentationScriptSchema,
} from '@edi/contracts';

/** Which window this renderer is. Main chooses it; unknown values fall back safely. */
export type Surface =
  'workspace' | 'artifact' | 'export' | 'pet' | 'voice-status' | 'character-menu' | 'pointer';
const surfaces: readonly Surface[] = [
  'workspace',
  'artifact',
  'export',
  'pet',
  'voice-status',
  'character-menu',
  'pointer',
];

const params = new URLSearchParams(location.search);
/** Colors main passes for windows without a bridge; anything else falls back. */
const hexColor = (fallback: string) =>
  z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .catch(fallback);

export const surface: Surface =
  surfaces.find(name => name === params.get('surface')) ?? 'workspace';

/** The content the artifact window opens with; later content arrives over the bridge. */
export const artifactParams = {
  initial: (() => {
    try {
      return artifactRefSchema.parse(JSON.parse(params.get('ref') ?? 'null'));
    } catch {
      return null;
    }
  })(),
};

/** The hidden export page: what to draw, and whether for a PDF or a picture. */
export const exportParams = {
  reference: artifactParams.initial,
  format: z.enum(['pdf', 'png', 'svg']).catch('pdf').parse(params.get('format')),
};

/** Main passes static bubble state in the URL. Validate it before rendering. */
export const bubbleParams = {
  state: statusBubbleStateSchema.catch('unavailable').parse(params.get('state')),
  side: bubbleSideSchema.catch('right').parse(params.get('side')),
  accent: hexColor('#3d2419').parse(params.get('accent')),
  name: assistantNameSchema.catch('Edi').parse(params.get('name')),
  text: bubbleNoticeSchema.catch('').parse(params.get('text')),
  artifact: (() => {
    try {
      return artifactSummarySchema.parse(JSON.parse(params.get('artifact') ?? 'null'));
    } catch {
      return null;
    }
  })(),
};

/** The character menu's labels use the companion's name. */
export const menuParams = {
  name: assistantNameSchema.catch('Edi').parse(params.get('name')),
};

const coordinate = (name: string) => {
  const value = Number(params.get(name));
  return Number.isFinite(value) ? Math.max(-20_000, Math.min(20_000, value)) : 0;
};

/** The pointer overlay's path, in window-local logical pixels. */
export const pointerParams = {
  from: { x: coordinate('fromX'), y: coordinate('fromY') },
  actions: (() => {
    try {
      return presentationScriptSchema.parse(JSON.parse(params.get('actions') ?? '[]'));
    } catch {
      return [];
    }
  })(),
  accent: hexColor('#3d2419').parse(params.get('accent')),
  outline: hexColor('#3b2016').parse(params.get('outline')),
  hand: hexColor('#bb7a4e').parse(params.get('hand')),
};
