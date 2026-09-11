import {
  bubbleNoticeSchema,
  bubbleSideSchema,
  skinSchema,
  statusBubbleStateSchema,
  presentationScriptSchema,
} from '@edi/contracts';

/** Which window this renderer is. Main chooses it; unknown values fall back safely. */
export type Surface = 'workspace' | 'pet' | 'voice-status' | 'character-menu' | 'pointer';
const surfaces: readonly Surface[] = [
  'workspace',
  'pet',
  'voice-status',
  'character-menu',
  'pointer',
];

const params = new URLSearchParams(location.search);

export const surface: Surface =
  surfaces.find(name => name === params.get('surface')) ?? 'workspace';

/** The bubble has no bridge, so main passes its state in the URL. Validate it anyway. */
export const bubbleParams = {
  state: statusBubbleStateSchema.catch('unavailable').parse(params.get('state')),
  side: bubbleSideSchema.catch('right').parse(params.get('side')),
  skin: skinSchema.catch('cloud').parse(params.get('skin')),
  text: bubbleNoticeSchema.catch('').parse(params.get('text')),
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
  skin: skinSchema.catch('cloud').parse(params.get('skin')),
};
