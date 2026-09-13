import { z } from 'zod';
import { approvalRequestSchema, toolStepSchema, type Activity } from './capabilities';
export * from './capabilities';
export * from './screen-context';
export * from './presentation';
export * from './screen-grounding';
export * from './permissions';
export * from './screen-intent';
export * from './voice';
export * from './voice-session';
import { voiceCommandSchemas, type VoiceHostEvent } from './voice';
import { permissionIdSchema, type PermissionSnapshot } from './permissions';
import { petScaleSchema } from './skin-geometry';
import {
  artifactKindSchema,
  artifactRefSchema,
  artifactSummarySchema,
  type Artifact,
  type ArtifactRef,
} from './artifacts';
export * from './artifacts';
export {
  placeArtifact,
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
  handTip,
  mapSkinPoint,
  desktopPetSize,
  petScaleSchema,
  petWindowSize,
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
export const chatMessageSchema = z
  .object({
    id: z.string().min(1).max(80),
    role: z.enum(['user', 'assistant']),
    text: z.string().max(32000),
    /** Content Edi showed during this turn, rendered inline in the conversation. */
    artifacts: z.array(artifactSummarySchema).max(6).optional(),
  })
  .strict();
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const agentStateSchema = z.object({
  configured: z.boolean(),
  model: z.string(),
  status: z.enum(['idle', 'running', 'done', 'stopped', 'error']),
  /** The foreground run, if any; approvals and steps belong to it. */
  runId: z.string().uuid().nullable(),
  /** The live user turn; empty when there is no foreground prompt. */
  prompt: z.string().max(8000),
  text: z.string().max(32000),
  error: z.string(),
  steps: z.array(toolStepSchema).max(20),
  /** Content shown during the live turn. */
  artifacts: z.array(artifactSummarySchema).max(6).default([]),
  /** Completed history plus the live turn, oldest first. */
  messages: z.array(chatMessageSchema).max(24),
  /** Screen Recording permission as of the last request; null before any request. */
  screenAccess: z.enum(['granted', 'denied', 'not-determined', 'restricted', 'unknown']).nullable(),
  /** The oldest pending approval; further writes wait behind it. */
  approval: approvalRequestSchema.nullable(),
  /** Work the model is doing outside Edi's own tools, for short progress in the bubble. */
  activity: z.enum(['searching-web']).nullable().optional(),
});
export type AgentState = z.infer<typeof agentStateSchema>;

export function emptyAgentState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    configured: false,
    model: '',
    status: 'idle',
    runId: null,
    prompt: '',
    text: '',
    error: '',
    steps: [],
    artifacts: [],
    messages: [],
    approval: null,
    screenAccess: null,
    ...overrides,
  };
}

export const skinSchema = z.enum(['edi', 'mochi']);
export type SkinId = z.infer<typeof skinSchema>;
import { voiceChoicesSchema, voiceModelSchema, voiceSelectionSchema } from './voice-catalog';
export * from './voice-catalog';

/**
 * Semantic character states, independent of artwork and voice provider. A skin
 * may express them differently, but it must not invent provider-specific moods.
 */
export const characterExpressionSchema = z.enum([
  'idle',
  'listening',
  'thinking',
  'speaking',
  'happy',
  'attention',
]);
export type CharacterExpression = z.infer<typeof characterExpressionSchema>;
export const screenPointSchema = z
  .object({
    x: z.number().finite().min(-100000).max(100000),
    y: z.number().finite().min(-100000).max(100000),
  })
  .strict();
export const petDragThreshold = 6;

/**
 * What the bubble beside the character shows. Listening and speaking are live
 * voice states; approval is the only interactive state.
 */
export const statusBubbleStateSchema = z.enum([
  'unavailable',
  'thinking',
  'listening',
  'speaking',
  'notice',
  'approval',
  'artifact',
]);
export type StatusBubbleState = z.infer<typeof statusBubbleStateSchema>;
export const bubbleSideSchema = z.enum(['left', 'right']);
export type BubbleSide = z.infer<typeof bubbleSideSchema>;
/** Retired bundled skins move to Edi instead of resetting every preference. */
const retiredSkins = new Set(['mira', 'cloud', 'sprout']);
const legacyScale: Record<string, number> = { small: 0.75, medium: 1, large: 1.35 };
export const settingsSchema = z.preprocess(
  value => {
    if (!value || typeof value !== 'object') return value;
    const saved = { ...(value as Record<string, unknown>) };
    if (typeof saved.skin === 'string' && retiredSkins.has(saved.skin)) saved.skin = 'edi';
    if (saved.petScale === undefined && typeof saved.petSize === 'string')
      saved.petScale = legacyScale[saved.petSize];
    delete saved.petSize;
    // Kokoro became the default speech model when voices became selectable. Preferences saved
    // before that still hold the old default (Pocket) and move once; an explicit Chatterbox
    // choice is kept.
    if (saved.voices === undefined && (saved.voiceModel ?? 'pocket') === 'pocket')
      saved.voiceModel = 'kokoro';
    return saved;
  },
  z.object({
    skin: skinSchema,
    pinned: z.boolean(),
    petPosition: screenPointSchema.nullable().default(null),
    /** When false, a spoken question is answered in the conversation without speech. */
    speakReplies: z.boolean().default(true),
    /** Speech engine used for spoken replies. */
    voiceModel: voiceModelSchema.default('kokoro'),
    /** The chosen voice within each speech model. */
    voices: voiceChoicesSchema,
    petScale: petScaleSchema.default(1),
  }),
);
export type Settings = z.infer<typeof settingsSchema>;
export const defaultSettings: Settings = {
  skin: 'edi',
  pinned: false,
  petPosition: null,
  speakReplies: true,
  voiceModel: 'kokoro',
  voices: { kokoro: 'af_heart', pocket: 'jane', 'chatterbox-turbo': 'calm' },
  petScale: 1,
};
/**
 * Every place the card can show, as a stable, versioned destination list. Edi's
 * own navigation targets these IDs; there are no arbitrary routes.
 */
export const workspaceSections = [
  'home',
  'conversations',
  'library',
  'skills',
  'connectors',
  'appearance',
  'settings',
] as const;
export const settingsPages = [
  'settings.ai',
  'settings.voice',
  'settings.keyboard',
  'settings.privacy',
  'settings.activity',
  'settings.about',
] as const;
export const workspaceViewSchema = z.enum([...workspaceSections, ...settingsPages]);
export type WorkspaceView = z.infer<typeof workspaceViewSchema>;
export type WorkspaceSection = (typeof workspaceSections)[number];

/** A saved note as the Library lists it. The file path stays in main. */
export const libraryItemSchema = z
  .object({
    id: z.string().min(1).max(80),
    kind: artifactKindSchema,
    title: z.string().max(200),
    bytes: z.number().int().nonnegative(),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();
export const librarySchema = z.array(libraryItemSchema).max(500);
export type LibraryItem = z.infer<typeof libraryItemSchema>;

/**
 * One entry in the model picker. Main fetches OpenRouter's public catalog and keeps
 * only models Edi can use: image input (screen questions) and tool calling (notes).
 */
export const modelOptionSchema = z
  .object({
    id: modelIdSchema,
    name: z.string().max(160),
    contextLength: z.number().int().nonnegative(),
    /** US dollars per million input tokens; null when the catalog doesn't say. */
    inputPrice: z.number().nonnegative().nullable(),
    /** Edi's pick for a kind of use; null for everything else. */
    recommended: z.enum(['fast', 'balanced', 'best']).nullable(),
  })
  .strict();
export const modelCatalogSchema = z.array(modelOptionSchema).max(1000);
export type ModelOption = z.infer<typeof modelOptionSchema>;

/** What is actually available on this Mac right now, for Settings to report truthfully. */
export const systemInfoSchema = z
  .object({
    version: z.string().max(40),
    voice: z
      .object({
        available: z.boolean(),
        name: z.string().max(60),
        models: z
          .array(
            z
              .object({
                id: voiceModelSchema,
                name: z.string().max(60),
                available: z.boolean(),
                expressions: z.boolean(),
                detail: z.string().max(160),
              })
              .strict(),
          )
          .length(3),
      })
      .strict(),
    pushToTalk: z
      .object({ status: z.enum(['starting', 'ready', 'unavailable']), label: z.string().max(20) })
      .strict(),
    notesFolder: z.string().max(1024),
  })
  .strict();
export type SystemInfo = z.infer<typeof systemInfoSchema>;
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
      action: z.enum(['content', 'settings', 'sleep', 'quit', 'dismiss']),
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
      /** Omit to keep the saved key and change only the model. */
      apiKey: z.string().trim().min(10).max(512).optional(),
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
  z.object({ type: z.literal('show-workspace'), view: workspaceViewSchema.optional() }).strict(),
  z.object({ type: z.literal('permissions-refresh') }).strict(),
  z.object({ type: z.literal('permission-request'), permission: permissionIdSchema }).strict(),
  z
    .object({ type: z.literal('permission-open-settings'), permission: permissionIdSchema })
    .strict(),
  z.object({ type: z.literal('permission-dismiss'), permission: permissionIdSchema }).strict(),
  z.object({ type: z.literal('hide-workspace') }).strict(),
  z.object({ type: z.literal('apply-skin'), skin: skinSchema }).strict(),
  z.object({ type: z.literal('set-pinned'), pinned: z.boolean() }).strict(),
  z.object({ type: z.literal('set-expanded'), expanded: z.boolean() }).strict(),
  z.object({ type: z.literal('set-speak-replies'), enabled: z.boolean() }).strict(),
  z.object({ type: z.literal('set-voice-model'), model: voiceModelSchema }).strict(),
  /** Choose a voice within a model; the voice must belong to that model. */
  z.object({ type: z.literal('set-voice'), selection: voiceSelectionSchema }).strict(),
  /** Play a short sample of a voice through Edi's speaker, only while voice is idle. */
  z.object({ type: z.literal('preview-voice'), selection: voiceSelectionSchema }).strict(),
  z
    .object({
      type: z.literal('set-pet-scale'),
      scale: petScaleSchema,
      /** False while the slider is moving; true once, when it settles, to save. */
      commit: z.boolean(),
    })
    .strict(),
  z.object({ type: z.literal('open-artifact'), ref: artifactRefSchema }).strict(),
  /** Artifact window actions. Main resolves content and paths from the reference itself. */
  z.object({ type: z.literal('artifact-copy'), ref: artifactRefSchema }).strict(),
  z.object({ type: z.literal('artifact-download'), ref: artifactRefSchema }).strict(),
  z.object({ type: z.literal('artifact-reveal'), ref: artifactRefSchema }).strict(),
  z.object({ type: z.literal('close-artifact') }).strict(),
  /** The card reports where the person is, so Edi can answer "where am I?" truthfully. */
  z.object({ type: z.literal('workspace-view'), view: workspaceViewSchema }).strict(),
  z.object({ type: z.literal('reveal-library-item'), id: z.string().min(1).max(80) }).strict(),
  /** A source link the person clicked in a reply; main opens it in their default browser. */
  z
    .object({
      type: z.literal('open-link'),
      url: z
        .string()
        .max(2048)
        .refine(value => {
          try {
            const url = new URL(value);
            return (
              (url.protocol === 'https:' || url.protocol === 'http:') &&
              !url.username &&
              !url.password
            );
          } catch {
            return false;
          }
        }, 'Only web links can be opened'),
    })
    .strict(),
  /** The person confirmed Delete in Library; main moves the file to the Trash by id. */
  z.object({ type: z.literal('library-delete'), id: z.string().uuid() }).strict(),
  z.object({ type: z.literal('pet-hit-test'), interactive: z.boolean() }).strict(),
  ...voiceCommandSchemas,
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
  permissions(): Promise<PermissionSnapshot>;
  onPermissions(callback: (snapshot: PermissionSnapshot) => void): () => void;
  onNavigate(callback: (view: WorkspaceView) => void): () => void;
  /** Main asks the artifact window to show different content (the window is reused). */
  onOpenArtifact(callback: (ref: ArtifactRef) => void): () => void;
  artifact(ref: ArtifactRef): Promise<Artifact>;
  agent(): Promise<AgentState>;
  /** Recent runs and their tool outcomes, newest first. */
  activity(): Promise<Activity>;
  /** Workspace artifacts and saved notes, newest first. */
  library(): Promise<LibraryItem[]>;
  system(): Promise<SystemInfo>;
  /** Models compatible with Edi, from OpenRouter's public catalog. Needs no key. */
  models(): Promise<ModelOption[]>;
  onAgent(callback: (state: AgentState) => void): () => void;
  settings(): Promise<Settings>;
  command(command: Command): Promise<void>;
  onSettings(callback: (settings: Settings) => void): () => void;
  /** Voice session instructions for the pet window's microphone and speaker. */
  onVoice(callback: (event: VoiceHostEvent) => void): () => void;
  /** Live semantic state; only the pet renderer translates this into motion. */
  onCharacterExpression(callback: (expression: CharacterExpression) => void): () => void;
}
export const skins = [
  {
    id: 'edi',
    name: 'Edi',
    description: 'Warm, bright, and always nearby.',
    color: '#3d2419',
    fill: '#b5744c',
    accent: '#3d2419',
  },
  {
    id: 'mochi',
    name: 'Mochi',
    description: 'Soft, cheerful, and a little bouncy.',
    color: '#71493D',
    fill: '#fbf2e8',
    accent: '#71493D',
  },
] as const;
