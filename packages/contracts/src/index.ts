import { z } from 'zod';
import { assistantNameSchema } from './assistant-name';
import {
  characterDescriptorSchema,
  characterIdSchema,
  type CharacterDescriptor,
  type CharacterId,
} from './character/manifest';
import type { CharacterExpression, CharacterMood } from './character/expressions';
export { assistantNameSchema } from './assistant-name';
export * from './character/expressions';
export * from './character/manifest';
export * from './character/package';
export {
  sanitizeCharacterArt,
  maxArtBytes,
  type ArtProblem,
  type SanitizedArt,
} from './character/svg';
import {
  approvalRequestSchema,
  toolStepSchema,
  type Activity,
  type ApprovalRule,
} from './capabilities';
export * from './capabilities';
export * from './screen-context';
export * from './presentation';
export * from './screen-grounding';
export * from './permissions';
export * from './desktop-context';
export * from './local-models';
export * from './screen-intent';
export * from './library-groups';
export * from './voice';
export * from './voice-session';
export * from './voice-turns';
export * from './privacy';
export * from './memory';
import { type Memory } from './memory';
export * from './suggestions';
import { suggestionLevelSchema } from './suggestions';
import { privateAppSchema, type PrivacyState } from './privacy';
import { voiceCommandSchemas, type VoiceHostEvent } from './voice';
import {
  permissionIdSchema,
  type FileAccess,
  type FileAccessAction,
  type PermissionSnapshot,
} from './permissions';
import { petScaleSchema } from './skin-geometry';
import type { UsagePeriod, UsageSummary } from './usage';
import { defaultTaskBudgetUsd, taskBudgetSchema, type Task } from './tasks';
import { scheduleNotifySchema, scheduleWhenSchema, type Schedule } from './schedules';
import { connectorUrlSchema, type Connector } from './connectors';
import { skillNameSchema, type SkillsState } from './skills';
import {
  localModelIdSchema,
  localModelUseSchema,
  localPackIdSchema,
  type LocalModelsState,
} from './local-models';
import {
  artifactKindSchema,
  artifactRefSchema,
  artifactSummarySchema,
  type Artifact,
  type ArtifactRef,
  type ExportFormat,
} from './artifacts';
export * from './artifacts';
export * from './usage';
export * from './tasks';
export * from './schedules';
export * from './connectors';
export * from './connector-catalog';
export * from './skills';
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
  characterGeometrySchema,
  type CharacterGeometry,
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
    /** `note`: a line from Edi itself, such as continuing a request once an app connected. */
    role: z.enum(['user', 'assistant', 'note']),
    text: z.string().max(32000),
    /** Content Edi showed during this turn, rendered inline in the conversation. */
    artifacts: z.array(artifactSummarySchema).max(6).optional(),
    /** What Edi did during a finished turn; the live turn's steps are on the state. */
    steps: z.array(toolStepSchema).max(40).optional(),
  })
  .strict();
export type ChatMessage = z.infer<typeof chatMessageSchema>;

/** One saved conversation in the list. */
export const conversationIdSchema = z.string().regex(/^[A-Za-z0-9-]{1,80}$/);
export const conversationSummarySchema = z
  .object({
    id: conversationIdSchema,
    title: z.string().max(80),
    updatedAt: z.number().int().nonnegative(),
    turns: z.number().int().nonnegative(),
    /** When listed by a search: the words that matched, in context. */
    excerpt: z.string().max(200).optional(),
  })
  .strict();
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;
export const conversationListSchema = z.array(conversationSummarySchema).max(200);

export const agentStateSchema = z.object({
  configured: z.boolean(),
  /** The conversation new questions join; null until the first question of a new one. */
  conversationId: conversationIdSchema.nullable().default(null),
  model: z.string(),
  status: z.enum(['idle', 'running', 'done', 'stopped', 'error']),
  /** The foreground run, if any; approvals and steps belong to it. */
  runId: z.string().uuid().nullable(),
  /** The live user turn; empty when there is no foreground prompt. */
  prompt: z.string().max(8000),
  /** Shown instead of the prompt when Edi started the live turn itself. */
  note: z.string().max(300).default(''),
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
    conversationId: null,
    model: '',
    status: 'idle',
    runId: null,
    prompt: '',
    note: '',
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

/** Settings keep the historical name `skin`; it holds any installed character's id. */
export const skinSchema = characterIdSchema;
export type SkinId = CharacterId;

import {
  cloudProviderSchema,
  voiceChoicesSchema,
  voiceInputSchema,
  voiceModelSchema,
  voiceWordsSchema,
  voiceDeliverySchema,
  voicePackIdSchema,
  voicePackStatusSchema,
  voiceSelectionSchema,
  personalVoiceIdSchema,
  personalVoiceListSchema,
  type CloudProviderId,
  type CloudVoiceOption,
  type PersonalVoiceAddResult,
} from './voice-catalog';
export * from './voice-catalog';

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
  /** A quiet offer from what's in front: one line, one action, and Not now. */
  'suggestion',
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
    // Pocket was removed and Kokoro is the default: a saved Pocket choice moves to Kokoro.
    if (saved.voiceModel === 'pocket') saved.voiceModel = 'kokoro';
    // Chatterbox is the original model now: it speaks only in a voice made from a recording,
    // and its old built-in voice ("Calm"/"Expressive") became the delivery setting.
    if (saved.voiceModel === 'chatterbox-turbo') saved.voiceModel = 'chatterbox';
    const voices = saved.voices as Record<string, unknown> | undefined;
    if (voices && 'chatterbox-turbo' in voices) {
      const chosen = voices['chatterbox-turbo'];
      if (chosen === 'turbo') saved.voiceDelivery ??= 'expressive';
      voices.chatterbox = chosen === 'calm' || chosen === 'turbo' ? 'built-in' : chosen;
      delete voices['chatterbox-turbo'];
    }
    return saved;
  },
  z.object({
    skin: skinSchema,
    pinned: z.boolean(),
    petPosition: screenPointSchema.nullable().default(null),
    /** When false, a spoken question is answered in the conversation without speech. */
    speakReplies: z.boolean().default(true),
    /** What a background task may spend unless the person sets another cap for it. */
    taskBudgetUsd: taskBudgetSchema.catch(defaultTaskBudgetUsd).default(defaultTaskBudgetUsd),
    /** Send the app, window, page and selection in front with each question. */
    shareDesktopContext: z.boolean().default(true),
    /** Edi may keep what it learns about the person (Settings → Memory); it still asks first. */
    remember: z.boolean().catch(true).default(true),
    /** Quiet suggestions from what's in front, decided on this Mac. Silent until turned on. */
    suggestions: suggestionLevelSchema.catch('off').default('off'),
    /** When each suggestion was last made, so the same one doesn't come back for a week. */
    suggestionsShown: z.record(z.string(), z.number()).catch({}).default({}),
    /** Privacy mode: Edi doesn't look at the screen or at what's in front until turned off. */
    privacyPaused: z.boolean().catch(false).default(false),
    /** Pause looking while a call app shares the screen, and keep Edi out of the share. */
    pauseWhenSharing: z.boolean().catch(true).default(true),
    /** Apps Edi never looks at, besides password managers. */
    privateApps: z.array(privateAppSchema).max(50).catch([]).default([]),
    /** Speech engine used for spoken replies. */
    voiceModel: voiceModelSchema.default('kokoro'),
    /**
     * Who turns speech into words: whisper on this Mac, or Cartesia with the person's key
     * (microphone audio is then streamed to Cartesia while they talk).
     */
    voiceInput: voiceInputSchema.catch('local').default('local'),
    /** Names and words speech recognition should expect: people, companies, projects. */
    voiceWords: voiceWordsSchema.catch([]).default([]),
    /** The chosen voice within each speech model. */
    voices: voiceChoicesSchema,
    /** How Chatterbox reads, whichever of its voices is chosen. */
    voiceDelivery: voiceDeliverySchema.catch('calm').default('calm'),
    petScale: petScaleSchema.default(1),
    /** The companion's name; null means the character's own name (Edi, Mochi). */
    name: assistantNameSchema.nullable().catch(null).default(null),
    /** Skills the person switched off; every other available skill is on. */
    skillsOff: z.array(skillNameSchema).max(200).catch([]).default([]),
    /** A model on this Mac (`local/<runtime>/<name>`), or null for none. */
    localModel: localModelIdSchema.nullable().catch(null).default(null),
    /** Use it only when OpenRouter can't answer (offline, out of credits), or for every turn. */
    localModelUse: localModelUseSchema.catch('backup').default('backup'),
  }),
);
export type Settings = z.infer<typeof settingsSchema>;
export const defaultSettings: Settings = {
  skin: 'edi',
  pinned: false,
  petPosition: null,
  speakReplies: true,
  shareDesktopContext: true,
  remember: true,
  suggestions: 'off',
  suggestionsShown: {},
  privacyPaused: false,
  pauseWhenSharing: true,
  privateApps: [],
  taskBudgetUsd: defaultTaskBudgetUsd,
  skillsOff: [],
  localModel: null,
  localModelUse: 'backup',
  voiceModel: 'kokoro',
  voiceInput: 'local',
  voiceWords: [],
  voiceDelivery: 'calm',
  voices: {
    kokoro: 'af_heart',
    chatterbox: 'built-in',
    cartesia: null,
    elevenlabs: null,
  },
  petScale: 1,
  name: null,
};

/** What the companion is called: the person's chosen name, otherwise its character's name. */
export function assistantName(settings: Pick<Settings, 'name'>, characterName: string): string {
  return settings.name ?? characterName;
}
/**
 * Every place the card can show, as a stable, versioned destination list. Edi's
 * own navigation targets these IDs; there are no arbitrary routes.
 */
export const workspaceSections = [
  'home',
  'conversations',
  'tasks',
  'library',
  'skills',
  'connectors',
  'appearance',
  'settings',
] as const;
export const settingsPages = [
  'settings.ai',
  'settings.voice',
  'settings.usage',
  'settings.keyboard',
  'settings.privacy',
  'settings.memory',
  'settings.behavior',
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
    /** Pinned to the top of the Library. */
    pinned: z.boolean(),
    /** Edi can make it again from the request that produced it (generated content only). */
    regenerable: z.boolean(),
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
        /** "Voice · Model": a cloud voice name alone can be 60 characters. */
        name: z.string().max(120),
        models: z
          .array(
            z
              .object({
                id: voiceModelSchema,
                name: z.string().max(60),
                available: z.boolean(),
                expressions: z.boolean(),
                detail: z.string().max(160),
                /** Voices the person added from recordings on this Mac (Chatterbox only). */
                personalVoices: personalVoiceListSchema.optional(),
              })
              .strict(),
          )
          .length(4),
        /** On-device packs to download, with their progress. */
        packs: z.array(voicePackStatusSchema).max(4),
      })
      .strict(),
    pushToTalk: z
      .object({ status: z.enum(['starting', 'ready', 'unavailable']), label: z.string().max(20) })
      .strict(),
    /** Documents › Edi: notes, generated content and everything the Library lists. */
    workspaceFolder: z.string().max(1024),
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
  /** Download (or resume), pause, or remove a model Edi runs itself. */
  z
    .object({
      type: z.literal('local-pack'),
      action: z.enum(['download', 'pause', 'remove']),
      id: localPackIdSchema,
    })
    .strict(),
  /** Choose a model on this Mac (null for none) and whether it answers every turn. */
  z
    .object({
      type: z.literal('set-local-model'),
      model: localModelIdSchema.nullable(),
      use: localModelUseSchema,
    })
    .strict(),
  z.object({ type: z.literal('ask-agent'), prompt: z.string().trim().min(1).max(8000) }).strict(),
  z.object({ type: z.literal('stop-agent') }).strict(),
  z.object({ type: z.literal('new-conversation') }).strict(),
  z
    .object({
      type: z.literal('start-task'),
      prompt: z.string().trim().min(1).max(8000),
      budgetUsd: taskBudgetSchema.optional(),
    })
    .strict(),
  z.object({ type: z.literal('stop-task'), id: z.string().uuid() }).strict(),
  z.object({ type: z.literal('delete-task'), id: z.string().uuid() }).strict(),
  z
    .object({
      type: z.literal('raise-task-budget'),
      id: z.string().uuid(),
      addUsd: taskBudgetSchema,
    })
    .strict(),
  z.object({ type: z.literal('set-task-budget'), budgetUsd: taskBudgetSchema }).strict(),
  z
    .object({
      type: z.literal('create-schedule'),
      prompt: z.string().trim().min(1).max(8000),
      when: scheduleWhenSchema,
      notify: scheduleNotifySchema,
      budgetUsd: taskBudgetSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('set-schedule-enabled'),
      id: z.string().uuid(),
      enabled: z.boolean(),
    })
    .strict(),
  /** Let a schedule act on its own, or make it wait for you again. */
  z
    .object({
      type: z.literal('set-schedule-unattended'),
      id: z.string().uuid(),
      unattended: z.boolean(),
    })
    .strict(),
  z.object({ type: z.literal('delete-schedule'), id: z.string().uuid() }).strict(),
  z.object({ type: z.literal('remove-approval-rule'), id: z.string().uuid() }).strict(),
  /** Settings → Behavior: how much Edi says on its own, and answering what it suggests. */
  z.object({ type: z.literal('set-suggestions'), level: suggestionLevelSchema }).strict(),
  z.object({ type: z.literal('suggestion-accept') }).strict(),
  z.object({ type: z.literal('suggestion-dismiss') }).strict(),
  /** Settings → Memory: keep new things or stop, and edit, remove or clear what Edi remembers. */
  z.object({ type: z.literal('set-remember'), enabled: z.boolean() }).strict(),
  z
    .object({
      type: z.literal('edit-memory'),
      id: z.string().uuid(),
      text: z.string().trim().min(1).max(400),
    })
    .strict(),
  z.object({ type: z.literal('remove-memory'), id: z.string().uuid() }).strict(),
  z.object({ type: z.literal('forget-everything') }).strict(),
  /** From Edi's short list by id, or any server by its address. */
  z
    .object({
      type: z.literal('add-connector'),
      catalogId: z.string().min(1).max(40).optional(),
      url: connectorUrlSchema.optional(),
      name: z.string().trim().min(1).max(60).optional(),
    })
    .strict()
    .refine(
      value => Boolean(value.catalogId) !== Boolean(value.url),
      'Choose an app or an address.',
    ),
  /** Signs in when needed, or reconnects. */
  z.object({ type: z.literal('connect-connector'), id: z.string().uuid() }).strict(),
  z
    .object({
      type: z.literal('set-connector-enabled'),
      id: z.string().uuid(),
      enabled: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal('set-connector-tool'),
      id: z.string().uuid(),
      tool: z.string().min(1).max(128),
      enabled: z.boolean(),
    })
    .strict(),
  z.object({ type: z.literal('use-recommended-tools'), id: z.string().uuid() }).strict(),
  z.object({ type: z.literal('test-connector'), id: z.string().uuid() }).strict(),
  z
    .object({ type: z.literal('set-skill-enabled'), name: skillNameSchema, enabled: z.boolean() })
    .strict(),
  z.object({ type: z.literal('remove-skill'), name: skillNameSchema }).strict(),
  z.object({ type: z.literal('reveal-skill'), name: skillNameSchema }).strict(),
  z.object({ type: z.literal('open-skills-folder') }).strict(),
  /** Skills › Add Skill…: choose a shared skill folder; main checks and copies it. */
  z.object({ type: z.literal('add-skill') }).strict(),
  z.object({ type: z.literal('remove-connector'), id: z.string().uuid() }).strict(),
  z
    .object({
      type: z.literal('setup-composio'),
      apiKey: z.string().trim().min(10).max(512).optional(),
    })
    .strict(),
  z.object({ type: z.literal('open-conversation'), id: conversationIdSchema }).strict(),
  z.object({ type: z.literal('delete-conversation'), id: conversationIdSchema }).strict(),
  z
    .object({
      type: z.literal('respond-approval'),
      callId: z.string().uuid(),
      /**
       * approve-always saves a rule where the action applies (a folder, site, app or any), or
       * else allows this kind of action for the rest of the conversation.
       */
      decision: z.enum(['approve', 'approve-always', 'deny']),
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
  /** Install the package checked earlier under this token (from a pick or a drop). */
  z.object({ type: z.literal('character-install'), token: z.string().uuid() }).strict(),
  z.object({ type: z.literal('character-remove'), id: characterIdSchema }).strict(),
  /** Name the companion, or null to go back to the character's own name. */
  z.object({ type: z.literal('set-name'), name: assistantNameSchema.nullable() }).strict(),
  z.object({ type: z.literal('set-pinned'), pinned: z.boolean() }).strict(),
  z.object({ type: z.literal('set-expanded'), expanded: z.boolean() }).strict(),
  z.object({ type: z.literal('set-speak-replies'), enabled: z.boolean() }).strict(),
  z.object({ type: z.literal('set-share-desktop-context'), enabled: z.boolean() }).strict(),
  /** Privacy mode (Settings → Privacy): pause looking now, and pause while sharing. */
  z
    .object({
      type: z.literal('set-privacy'),
      paused: z.boolean().optional(),
      pauseWhenSharing: z.boolean().optional(),
    })
    .strict(),
  /** Choose an app Edi never looks at; main opens the picker. */
  z.object({ type: z.literal('add-private-app') }).strict(),
  z.object({ type: z.literal('remove-private-app'), bundleId: z.string().max(200) }).strict(),
  z.object({ type: z.literal('set-voice-model'), model: voiceModelSchema }).strict(),
  z.object({ type: z.literal('set-voice-input'), input: voiceInputSchema }).strict(),
  z.object({ type: z.literal('set-voice-words'), words: voiceWordsSchema }).strict(),
  /** How Chatterbox reads: steadier, or livelier. */
  z.object({ type: z.literal('set-voice-delivery'), delivery: voiceDeliverySchema }).strict(),
  /** Download (or resume), pause, or remove an on-device voice pack. */
  z
    .object({
      type: z.literal('voice-pack'),
      action: z.enum(['download', 'pause', 'remove']),
      id: voicePackIdSchema,
    })
    .strict(),
  z.object({ type: z.literal('remove-personal-voice'), id: personalVoiceIdSchema }).strict(),
  /** Choose a voice within a model; the voice must belong to that model. */
  z.object({ type: z.literal('set-voice'), selection: voiceSelectionSchema }).strict(),
  /** Save a cloud voice key (checked with the provider first) or forget it. */
  z
    .object({
      type: z.literal('set-voice-key'),
      provider: cloudProviderSchema,
      apiKey: z.string().trim().min(20).max(256),
    })
    .strict(),
  z.object({ type: z.literal('forget-voice-key'), provider: cloudProviderSchema }).strict(),
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
  /** A diagram that can't be drawn: Edi fixes it in place, with the drawing error as the reason. */
  z
    .object({
      type: z.literal('artifact-fix'),
      ref: artifactRefSchema,
      problem: z.string().max(300),
    })
    .strict(),
  /** Show the most recent export in Finder; main remembers where it wrote it. */
  z.object({ type: z.literal('reveal-export') }).strict(),
  /**
   * The person drew a mark on their own screen to say "this bit". The box is in the overlay's
   * own pixels, which are that display's logical points.
   */
  z
    .object({
      type: z.literal('annotation-drawn'),
      x: z.number().int().min(-20_000).max(20_000),
      y: z.number().int().min(-20_000).max(20_000),
      width: z.number().int().min(1).max(20_000),
      height: z.number().int().min(1).max(20_000),
    })
    .strict(),
  /**
   * The hidden export page has drawn its content: PDFs are printed from it; a diagram also
   * hands back its picture (SVG text, or a PNG data URL).
   */
  z
    .object({
      type: z.literal('export-ready'),
      svg: z
        .string()
        .max(5_000_000)
        .refine(value => /^\s*<svg[\s>]/.test(value), 'Not an SVG image')
        .optional(),
      png: z
        .string()
        .max(30_000_000)
        .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/)
        .optional(),
      failed: z.boolean().optional(),
    })
    .strict(),
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
  /** Library Rename: a new title, and a matching file name in the same folder. */
  z
    .object({
      type: z.literal('library-rename'),
      id: z.string().uuid(),
      title: z.string().trim().min(1).max(120),
    })
    .strict(),
  z.object({ type: z.literal('library-pin'), id: z.string().uuid(), pinned: z.boolean() }).strict(),
  /** Edi makes a generated item again from its original request, in that conversation. */
  z.object({ type: z.literal('library-regenerate'), id: z.string().uuid() }).strict(),
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
  /** Which folders Edi's file tools may use, and whether Full Disk Access is on. */
  fileAccess(): Promise<FileAccess>;
  fileAccessAction(action: FileAccessAction): Promise<FileAccess>;
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
  /** Models Ollama and LM Studio serve on this Mac; `fresh` asks the runtimes again. */
  localModels(fresh?: boolean): Promise<LocalModelsState>;
  /** Background tasks, active first then most recent. */
  tasks(): Promise<Task[]>;
  onTasks(callback: (tasks: Task[]) => void): () => void;
  /** Schedules and watches, enabled first then by next run. */
  schedules(): Promise<Schedule[]>;
  onSchedules(callback: (schedules: Schedule[]) => void): () => void;
  /** Saved "Always allow" choices, newest first. */
  approvalRules(): Promise<ApprovalRule[]>;
  onApprovalRules(callback: (rules: ApprovalRule[]) => void): () => void;
  /** Privacy mode now: whether Edi is looking, and the app sharing the screen. */
  privacy(): Promise<PrivacyState>;
  onPrivacy(callback: (state: PrivacyState) => void): () => void;
  /** What Edi remembers about the person, oldest first. */
  memories(): Promise<Memory[]>;
  onMemories(callback: (memories: Memory[]) => void): () => void;
  /** Connected apps and their tools. */
  connectors(): Promise<Connector[]>;
  /** Every skill, re-reading Documents › Edi › Skills first. */
  skills(): Promise<SkillsState>;
  onSkills(callback: (skills: SkillsState) => void): () => void;
  onConnectors(callback: (connectors: Connector[]) => void): () => void;
  /** Whether the Composio API key has been configured. */
  composioConfigured(): Promise<boolean>;
  /** Saved conversations, most recently active first. */
  conversations(query?: string): Promise<ConversationSummary[]>;
  /** What Edi used over the last 1, 7 or 30 days. */
  usage(days: UsagePeriod): Promise<UsageSummary>;
  /** Voices on the person's Cartesia or ElevenLabs account; needs that key. */
  cloudVoices(provider: CloudProviderId): Promise<CloudVoiceOption[]>;
  onAgent(callback: (state: AgentState) => void): () => void;
  settings(): Promise<Settings>;
  command(command: Command): Promise<void>;
  /**
   * Export shown content to Documents › Edi › Exports, or where the person picks when `choose`.
   * Resolves with the file name, or null when the person cancels the save panel.
   */
  exportArtifact(
    ref: ArtifactRef,
    format: ExportFormat,
    choose?: boolean,
  ): Promise<{ name: string } | null>;
  onSettings(callback: (settings: Settings) => void): () => void;
  /** Voice session instructions for the pet window's microphone and speaker. */
  onVoice(callback: (event: VoiceHostEvent) => void): () => void;
  /** Live semantic state; only the pet renderer translates this into motion. */
  onCharacterExpression(callback: (expression: CharacterExpression) => void): () => void;
  /** How the moment feels; lasts for a reply or a while. */
  onCharacterMood(callback: (mood: CharacterMood) => void): () => void;
  /** Built-in and installed characters, checked and ready to render. */
  characters(): Promise<CharacterDescriptor[]>;
  onCharacters(callback: (characters: CharacterDescriptor[]) => void): () => void;
  /** Choose a .edichar file and check it; nothing is installed yet. Null when cancelled. */
  pickCharacterPackage(): Promise<CharacterInspection | null>;
  /** Check a .edichar file dropped on the card. */
  inspectCharacterFile(file: File): Promise<CharacterInspection>;
  /**
   * Add a Chatterbox voice: main asks for a recording, converts it and keeps it on this Mac.
   * `consent` is the person confirming the voice is theirs or its speaker agreed.
   */
  addPersonalVoice(input: { name: string; consent: true }): Promise<PersonalVoiceAddResult>;
}
/** What checking a package found. Install it by sending `character-install` with the token. */
export const characterInspectionSchema = z
  .object({
    token: z.string().uuid(),
    fileName: z.string().max(200),
    character: characterDescriptorSchema.nullable(),
    manifest: z
      .object({ id: z.string().max(64), name: z.string().max(60), version: z.string().max(20) })
      .nullable(),
    problems: z
      .array(
        z.object({ level: z.enum(['error', 'warning']), message: z.string().max(400) }).strict(),
      )
      .max(64),
    /** The installed version this would replace, if any. */
    replaces: z.string().max(20).nullable(),
  })
  .strict();
export type CharacterInspection = z.infer<typeof characterInspectionSchema>;
