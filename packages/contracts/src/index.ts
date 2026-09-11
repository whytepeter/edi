import { z } from 'zod';
import { approvalRequestSchema, toolStepSchema, type Activity } from './capabilities';
export * from './capabilities';
export {
  placeCard,
  placeSpeechBubble,
  placeContextMenu,
  clampWindow,
  type Rect,
} from './window-placement';
export {
  skinGeometrySchema,
  skinGeometry,
  handPaths,
  mapSkinPoint,
  desktopPetSize,
  type SkinGeometry,
} from './skin-geometry';

// Presentation data only: never HTML, scripts, or executable component names.
const shortText = z.string().trim().min(1).max(240);
export const contentCardSchema = z
  .object({
    version: z.literal(1),
    title: shortText,
    blocks: z
      .array(
        z.discriminatedUnion('type', [
          z.object({ type: z.literal('text'), text: z.string().min(1).max(8000) }).strict(),
          z.object({ type: z.literal('steps'), labels: z.array(shortText).min(2).max(6) }).strict(),
          z.object({ type: z.literal('local-video'), caption: shortText }).strict(),
        ]),
      )
      .min(1)
      .max(20),
  })
  .strict();
export type ContentCard = z.infer<typeof contentCardSchema>;

export const modelIdSchema = z
  .string()
  .trim()
  .min(3)
  .max(160)
  .regex(/^[a-zA-Z0-9_.:/-]+$/);
export const agentStateSchema = z.object({
  configured: z.boolean(),
  model: z.string(),
  status: z.enum(['idle', 'running', 'done', 'stopped', 'error']),
  /** The foreground run, if any; approvals and steps belong to it. */
  runId: z.string().uuid().nullable(),
  text: z.string().max(32000),
  error: z.string(),
  steps: z.array(toolStepSchema).max(20),
  /** The oldest pending approval; further writes wait behind it. */
  approval: approvalRequestSchema.nullable(),
});
export type AgentState = z.infer<typeof agentStateSchema>;

export const skinSchema = z.enum(['cloud', 'sprout']);
export type SkinId = z.infer<typeof skinSchema>;
export const screenPointSchema = z
  .object({
    x: z.number().finite().min(-100000).max(100000),
    y: z.number().finite().min(-100000).max(100000),
  })
  .strict();
export const petDragThreshold = 6;

/** What the status bubble beside the character shows. Listening requires a live microphone. */
export const statusBubbleStateSchema = z.enum(['unavailable', 'thinking', 'listening']);
export type StatusBubbleState = z.infer<typeof statusBubbleStateSchema>;
export const bubbleSideSchema = z.enum(['left', 'right']);
export type BubbleSide = z.infer<typeof bubbleSideSchema>;
export const settingsSchema = z.object({
  skin: skinSchema,
  pinned: z.boolean(),
  petPosition: screenPointSchema.nullable().default(null),
});
export type Settings = z.infer<typeof settingsSchema>;
export const defaultSettings: Settings = { skin: 'cloud', pinned: false, petPosition: null };
export const commandSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('request-listening'),
      mode: z.enum(['conversation', 'push-to-talk']).default('conversation'),
    })
    .strict(),
  z.object({ type: z.literal('release-listening'), cancelled: z.boolean() }).strict(),
  z
    .object({
      type: z.literal('character-action'),
      action: z.enum(['conversation', 'content', 'stop', 'sleep', 'quit', 'dismiss']),
    })
    .strict(),
  z
    .object({
      type: z.literal('character-menu'),
      /** Pointer position of the right-click, so the menu opens under the cursor. */
      point: screenPointSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('configure-agent'),
      apiKey: z.string().trim().min(10).max(512),
      model: modelIdSchema,
    })
    .strict(),
  z.object({ type: z.literal('disconnect-agent') }).strict(),
  z.object({ type: z.literal('ask-agent'), prompt: z.string().trim().min(1).max(8000) }).strict(),
  z.object({ type: z.literal('stop-agent') }).strict(),
  z
    .object({
      type: z.literal('respond-approval'),
      callId: z.string().uuid(),
      decision: z.enum(['approve', 'deny']),
    })
    .strict(),
  z.object({ type: z.literal('show-workspace') }).strict(),
  z.object({ type: z.literal('hide-workspace') }).strict(),
  z.object({ type: z.literal('apply-skin'), skin: skinSchema }).strict(),
  z.object({ type: z.literal('set-pinned'), pinned: z.boolean() }).strict(),
  z.object({ type: z.literal('set-expanded'), expanded: z.boolean() }).strict(),
  z.object({ type: z.literal('pet-hit-test'), interactive: z.boolean() }).strict(),
  z
    .object({
      type: z.literal('pet-drag'),
      phase: z.enum(['start', 'move', 'end', 'cancel']),
      pointerId: z.number().int().nonnegative(),
      point: screenPointSchema,
    })
    .strict(),
]);
export type Command = z.infer<typeof commandSchema>;
export interface DesktopBridge {
  agent(): Promise<AgentState>;
  /** Recent runs and their tool outcomes, newest first. */
  activity(): Promise<Activity>;
  onAgent(callback: (state: AgentState) => void): () => void;
  settings(): Promise<Settings>;
  command(command: Command): Promise<void>;
  onSettings(callback: (settings: Settings) => void): () => void;
}
export const skins = [
  { id: 'cloud', name: 'Cloud', description: 'A little curious. Always nearby.', color: '#759bea' },
  { id: 'sprout', name: 'Sprout', description: 'A softer shade of company.', color: '#759881' },
] as const;
