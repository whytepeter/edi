import { z } from 'zod';

// The same rule as `modelIdSchema` in index.ts, which re-exports this file (so no import back).
const modelIdSchema = z
  .string()
  .trim()
  .min(3)
  .max(160)
  .regex(/^[a-zA-Z0-9_.:/-]+$/);

/**
 * Models served on this Mac by Ollama or LM Studio. Their ids are `local/<runtime>/<name>`, so
 * they never collide with OpenRouter's `<vendor>/<model>` ids and main knows where to send them.
 */
/** `edi`: a model Edi downloaded and runs itself; the others are apps already on the Mac. */
export const localRuntimeSchema = z.enum(['edi', 'ollama', 'lmstudio']);
export type LocalRuntime = z.infer<typeof localRuntimeSchema>;

export const localRuntimeNames: Record<LocalRuntime, string> = {
  edi: 'Edi',
  ollama: 'Ollama',
  lmstudio: 'LM Studio',
};

const PREFIX = 'local/';

export function localModelId(runtime: LocalRuntime, name: string) {
  return `${PREFIX}${runtime}/${name}`;
}

/** The runtime and the name it knows the model by, or null for an OpenRouter id. */
export function parseLocalModelId(id: string): { runtime: LocalRuntime; name: string } | null {
  if (!id.startsWith(PREFIX)) return null;
  const rest = id.slice(PREFIX.length);
  const slash = rest.indexOf('/');
  const runtime = localRuntimeSchema.safeParse(rest.slice(0, slash));
  const name = rest.slice(slash + 1);
  return slash > 0 && runtime.success && name ? { runtime: runtime.data, name } : null;
}

/**
 * One local model and what its runtime says it can do. Edi needs image input for screen
 * questions and tool calling for everything it does; a model without either is "limited": it
 * answers in words only, without seeing the screen or taking actions.
 */
export const localModelOptionSchema = z
  .object({
    id: modelIdSchema,
    runtime: localRuntimeSchema,
    name: z.string().max(160),
    contextLength: z.number().int().nonnegative(),
    vision: z.boolean(),
    tools: z.boolean(),
  })
  .strict();
export type LocalModelOption = z.infer<typeof localModelOptionSchema>;

/**
 * A model Edi can download and run itself, with no other app installed: the pack ids Settings
 * offers, and how far each has got. The runner ships with Edi; the model files do not.
 */
export const localPackIdSchema = z.enum(['language-small', 'language-standard']);
export type LocalPackId = z.infer<typeof localPackIdSchema>;

export const localPackStatusSchema = z
  .object({
    id: localPackIdSchema,
    name: z.string().max(60),
    /** What the model can do once it is installed, so Settings can say before downloading. */
    vision: z.boolean(),
    tools: z.boolean(),
    bytes: z.number().int().nonnegative(),
    received: z.number().int().nonnegative(),
    state: z.enum(['missing', 'downloading', 'paused', 'installed', 'failed', 'development']),
    error: z.string().max(200).optional(),
  })
  .strict();
export type LocalPackStatus = z.infer<typeof localPackStatusSchema>;

export const localModelsStateSchema = z
  .object({
    /** Which runtimes answered on this Mac just now. */
    runtimes: z.array(z.object({ id: localRuntimeSchema, running: z.boolean() }).strict()).max(3),
    models: z.array(localModelOptionSchema).max(200),
    /** Models Edi can download and run itself. */
    packs: z.array(localPackStatusSchema).max(4),
  })
  .strict();
export type LocalModelsState = z.infer<typeof localModelsStateSchema>;

/** A model id that names a model on this Mac. */
export const localModelIdSchema = modelIdSchema.refine(
  id => parseLocalModelId(id) !== null,
  'Not a model on this Mac.',
);

/** How Edi uses the chosen local model: only when OpenRouter can't answer, or for every turn. */
export const localModelUseSchema = z.enum(['backup', 'main']);
export type LocalModelUse = z.infer<typeof localModelUseSchema>;
