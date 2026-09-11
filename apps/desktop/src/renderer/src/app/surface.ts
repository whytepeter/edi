import { bubbleSideSchema, skinSchema, statusBubbleStateSchema } from '@edi/contracts';

/** Which window this renderer is. Main chooses it; unknown values fall back safely. */
export type Surface = 'workspace' | 'pet' | 'voice-status' | 'character-menu';
const surfaces: readonly Surface[] = ['workspace', 'pet', 'voice-status', 'character-menu'];

const params = new URLSearchParams(location.search);

export const surface: Surface =
  surfaces.find(name => name === params.get('surface')) ?? 'workspace';

/** The bubble has no bridge, so main passes its state in the URL. Validate it anyway. */
export const bubbleParams = {
  state: statusBubbleStateSchema.catch('unavailable').parse(params.get('state')),
  side: bubbleSideSchema.catch('right').parse(params.get('side')),
  skin: skinSchema.catch('cloud').parse(params.get('skin')),
};
