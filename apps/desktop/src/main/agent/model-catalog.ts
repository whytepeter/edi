import { z } from 'zod';
import { modelIdSchema, type ModelOption } from '@edi/contracts';

const CATALOG_URL = 'https://openrouter.ai/api/v1/models';
const FETCH_TIMEOUT_MS = 10_000;
const CACHE_MS = 60 * 60 * 1000;
const MAX_MODELS = 1000;

// Only the fields Edi reads; everything else in OpenRouter's catalog is ignored.
const catalogEntry = z.object({
  id: z.string(),
  name: z.string().optional(),
  context_length: z.number().nullish(),
  architecture: z.object({ input_modalities: z.array(z.string()).optional() }).optional(),
  pricing: z.object({ prompt: z.string().optional() }).optional(),
  created: z.number().optional(),
  supported_parameters: z.array(z.string()).optional(),
  reasoning: z
    .object({
      mandatory: z.boolean().optional(),
      supported_efforts: z.array(z.string()).optional(),
    })
    .nullish(),
});

/** Reasoning levels Edi asks for on spoken turns, least thinking first. */
export const quickEfforts = ['none', 'minimal', 'low', 'medium'] as const;
export type QuickEffort = (typeof quickEfforts)[number];

/**
 * The least thinking a model allows, so a spoken answer starts sooner. A model that may skip
 * reasoning gets none; one that must reason gets its lowest listed level. Anything unknown
 * (no reasoning field, no levels listed, only high levels) keeps the model's own default.
 */
export function quickEffort(
  reasoning: z.infer<typeof catalogEntry>['reasoning'],
): QuickEffort | undefined {
  if (!reasoning) return undefined;
  if (reasoning.mandatory === false) return 'none';
  return quickEfforts.find(effort => reasoning.supported_efforts?.includes(effort));
}

/** Each model's quickest reasoning level, for every model that has one. */
export function quickEffortsFrom(raw: unknown): Map<string, QuickEffort> {
  const efforts = new Map<string, QuickEffort>();
  const entries = z.object({ data: z.array(z.unknown()) }).safeParse(raw);
  for (const value of entries.data?.data ?? []) {
    const entry = catalogEntry.safeParse(value);
    const effort = entry.success ? quickEffort(entry.data.reasoning) : undefined;
    if (entry.success && effort) efforts.set(entry.data.id, effort);
  }
  return efforts;
}

/**
 * Keeps models Edi can actually run: image input for screen questions and tool calling
 * for notes. Anything malformed is skipped rather than failing the whole list.
 */
export function compatibleModels(raw: unknown): ModelOption[] {
  const entries = z.object({ data: z.array(z.unknown()) }).safeParse(raw);
  if (!entries.success) throw new Error('Unexpected model catalog.');
  const models: ModelOption[] = [];
  const created = new Map<string, number>();
  for (const value of entries.data.data) {
    const entry = catalogEntry.safeParse(value);
    if (!entry.success || !modelIdSchema.safeParse(entry.data.id).success) continue;
    const { id, name, context_length, architecture, pricing, supported_parameters } = entry.data;
    created.set(id, entry.data.created ?? 0);
    if (!architecture?.input_modalities?.includes('image')) continue;
    if (!supported_parameters?.includes('tools')) continue;
    const perToken = Number(pricing?.prompt);
    models.push({
      id,
      name: (name || id).slice(0, 160),
      contextLength: Math.max(0, Math.floor(context_length ?? 0)),
      inputPrice: Number.isFinite(perToken) && perToken >= 0 ? perToken * 1_000_000 : null,
      recommended: null,
    });
    if (models.length === MAX_MODELS) break;
  }
  return recommend(models, created);
}

/**
 * Edi's short list: the newest model in each family that suits a kind of use. Families are
 * matched by id pattern, never pinned to a version, so the list stays current by itself.
 */
const picks: { role: NonNullable<ModelOption['recommended']>; pattern: RegExp }[] = [
  { role: 'fast', pattern: /^google\/gemini-[\d.]+-flash$/ },
  { role: 'balanced', pattern: /^anthropic\/claude-sonnet-[\d.]+$/ },
  { role: 'best', pattern: /^anthropic\/claude-opus-[\d.]+$/ },
];

function recommend(models: ModelOption[], created: Map<string, number>) {
  const chosen = new Map<string, NonNullable<ModelOption['recommended']>>();
  for (const { role, pattern } of picks) {
    const newest = models
      .filter(model => pattern.test(model.id))
      .sort((a, b) => (created.get(b.id) ?? 0) - (created.get(a.id) ?? 0))[0];
    if (newest) chosen.set(newest.id, role);
  }
  return models.map(model => ({ ...model, recommended: chosen.get(model.id) ?? null }));
}

/**
 * The page reader: the newest Gemini Flash Lite (cheap, fast, long context, good at reading),
 * by version number so the pick stays current; otherwise the fast pick.
 */
export function readerModelFrom(models: readonly ModelOption[]): string | null {
  const version = (id: string) =>
    /^google\/gemini-([\d.]+)-flash-lite$/.exec(id)?.[1]?.split('.').map(Number) ?? null;
  const newer = (a: number[], b: number[]) => {
    for (let i = 0; i < Math.max(a.length, b.length); i++)
      if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
    return false;
  };
  let best: { id: string; version: number[] } | null = null;
  for (const model of models) {
    const parsed = version(model.id);
    if (parsed && (!best || newer(parsed, best.version))) best = { id: model.id, version: parsed };
  }
  return best?.id ?? models.find(model => model.recommended === 'fast')?.id ?? null;
}

/** OpenRouter's public model list. No key or user data is sent; results are cached for an hour. */
export class ModelCatalog {
  private cached?: { at: number; models: ModelOption[]; efforts: Map<string, QuickEffort> };
  private pending?: Promise<ModelOption[]>;

  constructor(private readonly fetcher: typeof fetch = fetch) {}

  /**
   * The quickest reasoning level for a model, from the last catalog Edi fetched; undefined until
   * one has loaded. Never waits: a spoken turn is not held up by the network.
   */
  quickEffort(id: string): QuickEffort | undefined {
    if (!this.cached || Date.now() - this.cached.at >= CACHE_MS) void this.list().catch(() => {});
    return this.cached?.efforts.get(id);
  }

  list(): Promise<ModelOption[]> {
    if (this.cached && Date.now() - this.cached.at < CACHE_MS)
      return Promise.resolve(this.cached.models);
    this.pending ??= this.load().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  private async load() {
    const response = await this.fetcher(CATALOG_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Model catalog returned ${response.status}.`);
    const raw: unknown = await response.json();
    const models = compatibleModels(raw);
    this.cached = { at: Date.now(), models, efforts: quickEffortsFrom(raw) };
    return models;
  }
}
