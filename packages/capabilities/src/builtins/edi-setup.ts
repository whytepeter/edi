import { z } from 'zod';
import {
  assistantNameSchema,
  petScaleSchema,
  skillNameSchema,
  skinSchema,
  taskBudgetSchema,
  voiceInputSchema,
  voiceModelSchema,
  workspaceViewSchema,
  type ModelOption,
} from '@edi/contracts';
import { defineCapability } from '../types';

export interface EdiSetupSnapshot {
  /** `name` is what the person calls their companion; `app` is the product. */
  identity: { name: string; customName: boolean; app: 'Edi'; version: string };
  /** Where the person is in Edi right now. */
  location: { page: string; cardOpen: boolean; pinned: boolean };
  current: {
    character: { id: string; name: string };
    size: number;
    voice: {
      id: string;
      name: string;
      /** The voice within the model, e.g. Heart for Kokoro. */
      speakingVoice: { id: string; name: string };
      available: boolean;
      expressions: boolean;
      status: string;
      detail: string;
    };
    speakReplies: boolean;
    shareDesktopContext: boolean;
    taskBudgetUsd: number;
    voiceInput: string;
    voiceWords: string[];
    ai: {
      connected: boolean;
      model: string | null;
      /** A model on this Mac, and whether it answers every turn or only backs OpenRouter up. */
      localModel: string | null;
      localModelUse: 'backup' | 'main' | null;
    };
    /** Privacy mode: whether Edi may look at the screen and what's in front now, and why not. */
    privacy: { lookingAtScreen: boolean; reason: string | null };
    /** What Edi remembers about the person, and whether it may keep more (Settings → Memory). */
    memory: { remembering: boolean; items: string[] };
    pushToTalk: { status: string; shortcut: string };
  };
  workspace: {
    root: string;
    generatedContent: string;
    behavior: string;
  };
  library: {
    items: number;
    notes: number;
    artifacts: number;
    recent: { id: string; title: string }[];
  };
  skills: { id: string; name: string; active: boolean }[];
  connectors: { id: string; name: string; active: boolean }[];
  /** Short-list apps the user can connect now (edi_connect_app), by id. */
  appsToConnect: { id: string; name: string }[];
  permissions: { id: string; status: string }[];
  availableCharacters: { id: string; name: string }[];
  availableVoices: {
    id: string;
    name: string;
    available: boolean;
    expressions: boolean;
    detail: string;
    /** Cloud providers list the person's account voices; gender and accent may be unknown. */
    voices: { id: string; name: string; accent: string | null; gender: string | null }[];
  }[];
  /** Things Edi can do right now, and whether each asks the person first. */
  abilities: { name: string; asksFirst: boolean }[];
  /** Planned features that do not exist yet. Never claim these work. */
  notYetAvailable: string[];
}

/** Edi's own reversible preferences. Secrets and connections are deliberately absent. */
export const ediPreferencesSchema = z
  .object({
    name: assistantNameSchema
      .nullable()
      .optional()
      .describe(
        'Your name, only when the user asks to call you something else; null returns to the character’s own name',
      ),
    character: skinSchema.optional().describe('Character id from availableCharacters'),
    size: petScaleSchema
      .optional()
      .describe('Desktop size: 0.6 (small) to 1.6 (large); 1 is default'),
    pinned: z.boolean().optional().describe('Keep the card open when another app is focused'),
    speakReplies: z.boolean().optional().describe('Read spoken answers aloud'),
    voice: voiceModelSchema.optional().describe('Speech model id from availableVoices'),
    speakingVoice: z
      .string()
      .max(40)
      .optional()
      .describe('Voice id within that model, from availableVoices[].voices'),
    shareDesktopContext: z
      .boolean()
      .optional()
      .describe('Send the app, window, page and selected text in front with each question'),
    lookAtScreen: z
      .boolean()
      .optional()
      .describe(
        'false when the user asks you not to look at their screen (privacy mode); true to look again',
      ),
    taskBudgetUsd: taskBudgetSchema
      .optional()
      .describe('Default spending cap for a background task, in US dollars'),
    voiceInput: voiceInputSchema
      .optional()
      .describe('Who turns speech into words: local (on this Mac) or cartesia (needs its key)'),
    skills: z
      .array(z.object({ id: skillNameSchema, on: z.boolean() }).strict())
      .min(1)
      .max(20)
      .optional()
      .describe('Switch skills on or off, by id from skills'),
    addWords: z
      .array(z.string().trim().min(1).max(40))
      .min(1)
      .max(20)
      .optional()
      .describe('Names and words speech recognition should expect (people, companies, projects)'),
    removeWords: z
      .array(z.string().trim().min(1).max(40))
      .min(1)
      .max(20)
      .optional()
      .describe('Words to stop expecting, from voiceWords'),
  })
  .strict()
  .refine(patch => Object.keys(patch).length > 0, 'Change at least one preference.');
export type EdiPreferences = z.infer<typeof ediPreferencesSchema>;

const tiers: Record<string, NonNullable<ModelOption['recommended']>> = {
  fast: 'fast',
  fastest: 'fast',
  quick: 'fast',
  cheap: 'fast',
  cheapest: 'fast',
  balanced: 'balanced',
  default: 'balanced',
  recommended: 'balanced',
  best: 'best',
  smartest: 'best',
  strongest: 'best',
};

/**
 * The model someone named, from the models Edi can use: an id, a name ("GPT-5"), Edi's pick for
 * a kind of use ("fastest"), or words that narrow it to one. Several matches come back as a
 * question rather than a guess.
 */
export function pickModel(models: readonly ModelOption[], asked: string): ModelOption {
  const query = asked.trim().toLowerCase();
  const exact = models.find(
    model => model.id.toLowerCase() === query || model.name.toLowerCase() === query,
  );
  if (exact) return exact;
  const tier = tiers[query.replace(/\s*(model|one)$/, '')];
  const picked = tier && models.find(model => model.recommended === tier);
  if (picked) return picked;
  const words = query.split(/[^a-z0-9.]+/).filter(Boolean);
  const found = models.filter(model =>
    words.every(word => `${model.id} ${model.name}`.toLowerCase().includes(word)),
  );
  if (found.length === 1) return found[0]!;
  if (!found.length)
    throw new Error(
      `No model Edi can use matches “${asked}” (Edi needs image input and tool calling).`,
    );
  // “gpt 5” means openai/gpt-5 rather than gpt-5-mini; otherwise Edi's own pick among them.
  const slug = words.join('-');
  const named = found.filter(model => model.id.split('/').pop()?.toLowerCase() === slug);
  if (named.length === 1) return named[0]!;
  const recommended = found.filter(model => model.recommended);
  if (recommended.length === 1) return recommended[0]!;
  throw new Error(
    `Several models match “${asked}”: ${found
      .slice(0, 6)
      .map(model => `${model.name} (${model.id})`)
      .join(', ')}${found.length > 6 ? ', …' : ''}. Ask the user which one, then pass its id.`,
  );
}

const shownValue = (value: unknown): string =>
  value === null
    ? 'character’s own name'
    : Array.isArray(value)
      ? value
          .map(item =>
            typeof item === 'object' && item && 'id' in item
              ? `${String(item.id)} ${(item as { on?: boolean }).on ? 'on' : 'off'}`
              : String(item),
          )
          .join(', ')
      : String(value);

const pageNames: Record<z.infer<typeof workspaceViewSchema>, string> = {
  home: 'Home',
  conversations: 'Conversations',
  tasks: 'Tasks',
  library: 'Library',
  skills: 'Skills',
  connectors: 'Connectors',
  appearance: 'Appearance',
  settings: 'Settings',
  'settings.ai': 'Settings → AI',
  'settings.voice': 'Settings → Voice',
  'settings.usage': 'Settings → Usage',
  'settings.keyboard': 'Settings → Keyboard',
  'settings.privacy': 'Settings → Privacy & Permissions',
  'settings.memory': 'Settings → Memory',
  'settings.behavior': 'Settings → Behavior',
  'settings.activity': 'Settings → Activity',
  'settings.about': 'Settings → About',
};

/**
 * Live self-knowledge and control of Edi itself: navigation, its own preferences, and its
 * window. Never returns secrets, never changes connections, never opens arbitrary routes.
 */
export function ediSetupCapabilities(deps: {
  snapshot(): EdiSetupSnapshot;
  open(page: z.infer<typeof workspaceViewSchema>): void;
  change(patch: EdiPreferences): Promise<void> | void;
  window(action: 'close' | 'sleep'): void;
  /** Models Edi can use (OpenRouter's catalog, filtered). */
  models(): Promise<ModelOption[]>;
  /** Save the model for the next turn. */
  chooseModel(id: string): Promise<void>;
}) {
  const inspect = defineCapability({
    id: 'edi.inspect_setup',
    title: 'Check Edi setup',
    description:
      'Read Edi’s live state: where the person is in Edi, selected character, size, voice and its ' +
      'loading status, AI connection, shortcut, permissions, Library notes, skills, connectors, ' +
      'workspace locations, what Edi can do and what is not available yet. Use it whenever the user asks about Edi, ' +
      'what is selected or possible, why something is unavailable, or before changing a preference.',
    effect: 'read',
    timeoutMs: 2_000,
    input: z.object({}).strict(),
    prepare() {
      return {
        preview: {
          title: 'Check Edi setup',
          action: 'Check Setup',
          summary: 'Read Edi’s current non-secret configuration.',
          fields: [],
        },
        async execute() {
          return { summary: 'Checked Edi’s current setup.', output: deps.snapshot() };
        },
      };
    },
  });

  const open = defineCapability({
    id: 'edi.open_page',
    title: 'Open a page in Edi',
    description:
      'Open a page in Edi’s card, for example Settings, Settings → Voice, Appearance, Library or ' +
      'Conversations. Use when the user asks to go to, open or show part of Edi.',
    effect: 'read',
    timeoutMs: 2_000,
    input: z.object({ page: workspaceViewSchema }).strict(),
    prepare({ page }) {
      return {
        preview: {
          title: 'Open a page',
          action: 'Open',
          summary: `Open ${pageNames[page]}.`,
          fields: [],
        },
        async execute() {
          deps.open(page);
          return { summary: `Opened ${pageNames[page]}.` };
        },
      };
    },
  });

  const change = defineCapability({
    id: 'edi.change_preferences',
    title: 'Change Edi’s preferences',
    description:
      'Change Edi’s own reversible preferences: your name, character, desktop size, pin, whether spoken ' +
      'answers are read aloud, voice, speech recognition and its words, sharing what is in front, ' +
      'the background task budget, and skills on or off. Only use values listed by ' +
      'edi_inspect_setup. It cannot change the AI key, permissions or connections; send the user to ' +
      'that page instead. To switch the AI model use edi_choose_model.',
    effect: 'read',
    timeoutMs: 5_000,
    input: ediPreferencesSchema,
    prepare(patch) {
      const fields = Object.entries(patch).map(([label, value]) => ({
        label,
        value: shownValue(value),
      }));
      return {
        preview: {
          title: 'Change Edi’s preferences',
          action: 'Change',
          summary: 'Update Edi’s own preferences.',
          fields,
        },
        async execute() {
          await deps.change(patch);
          return {
            summary: `Changed ${fields.map(field => `${field.label} to ${field.value}`).join(', ')}.`,
          };
        },
      };
    },
  });

  const windowControl = defineCapability({
    id: 'edi.window',
    title: 'Close or sleep Edi',
    description:
      'Close Edi’s card, or put Edi to sleep (hide the character until ⌥ Space or the menu bar wakes it). ' +
      'Use only when the user asks for it.',
    effect: 'read',
    timeoutMs: 2_000,
    input: z.object({ action: z.enum(['close', 'sleep']) }).strict(),
    prepare({ action }) {
      return {
        preview: {
          title: action === 'close' ? 'Close the card' : 'Sleep Edi',
          action: action === 'close' ? 'Close' : 'Sleep',
          summary: action === 'close' ? 'Close Edi’s card.' : 'Hide Edi until woken.',
          fields: [],
        },
        async execute() {
          // Let the reply finish streaming before the window goes away.
          setTimeout(() => deps.window(action), 1200);
          return { summary: action === 'close' ? 'Closing the card.' : 'Going to sleep.' };
        },
      };
    },
  });

  const chooseModel = defineCapability({
    id: 'edi.choose_model',
    title: 'Switch the AI model',
    description:
      'Switch the AI model Edi answers with when the user asks (“use Claude Sonnet”, “switch to ' +
      'something faster”). Pass a model id (e.g. anthropic/claude-sonnet-5) or what the user ' +
      'said; “fast”, “balanced” and “best” pick Edi’s recommended models. If several match, the ' +
      'error lists them: ask the user which one. The new model answers from the next message.',
    effect: 'write',
    timeoutMs: 15_000,
    input: z
      .object({
        model: z
          .string()
          .trim()
          .min(2)
          .max(160)
          .describe('A model id, a model name, or fast / balanced / best'),
      })
      .strict(),
    async prepare({ model }) {
      const chosen = pickModel(await deps.models(), model);
      const price =
        chosen.inputPrice === null ? null : `$${chosen.inputPrice.toFixed(2)} per million tokens in`;
      return {
        preview: {
          title: 'Switch the AI model',
          action: 'Switch',
          summary: `Answer with ${chosen.name} from the next message.`,
          fields: [
            { label: 'Model', value: chosen.id },
            ...(price ? [{ label: 'Price', value: price }] : []),
          ],
        },
        async execute() {
          await deps.chooseModel(chosen.id);
          return {
            summary: `Switched to ${chosen.name}.`,
            output: { model: chosen.id, name: chosen.name, startsWith: 'the next message' },
          };
        },
      };
    },
  });

  return [inspect, open, change, windowControl, chooseModel] as const;
}
