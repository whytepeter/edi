import { z } from 'zod';
import {
  assistantNameSchema,
  petScaleSchema,
  skinSchema,
  voiceModelSchema,
  workspaceViewSchema,
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
    ai: { connected: boolean; model: string | null };
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
  })
  .strict()
  .refine(patch => Object.keys(patch).length > 0, 'Change at least one preference.');
export type EdiPreferences = z.infer<typeof ediPreferencesSchema>;

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
      'answers are read aloud, and voice. Only use values listed by edi_inspect_setup. It cannot ' +
      'change the AI key, permissions or connections; send the user to that page instead.',
    effect: 'read',
    timeoutMs: 5_000,
    input: ediPreferencesSchema,
    prepare(patch) {
      const fields = Object.entries(patch).map(([label, value]) => ({
        label,
        value: value === null ? 'character’s own name' : String(value),
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

  return [inspect, open, change, windowControl] as const;
}
