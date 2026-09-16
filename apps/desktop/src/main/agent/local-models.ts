import { z } from 'zod';
import {
  localModelId,
  modelIdSchema,
  type LocalModelOption,
  type LocalModelsState,
  type LocalRuntime,
} from '@edi/contracts';

/**
 * Models served on this Mac by Ollama or LM Studio, for offline and free turns. Edi asks each
 * runtime what a model can do instead of guessing from its name: Ollama's /api/show lists
 * `vision` and `tools`, LM Studio marks vision models `vlm` and lists `tool_use`. Only
 * loopback addresses are contacted, and nothing about the person is sent.
 */
export const localRuntimes: Record<LocalRuntime, { base: string; openai: string }> = {
  ollama: { base: 'http://127.0.0.1:11434', openai: 'http://127.0.0.1:11434/v1' },
  lmstudio: { base: 'http://127.0.0.1:1234', openai: 'http://127.0.0.1:1234/v1' },
};

const PROBE_MS = 1_500;
const SHOW_MS = 4_000;
const CACHE_MS = 15_000;
const MAX_MODELS = 100;

const ollamaTags = z.object({ models: z.array(z.object({ name: z.string() })) });
const ollamaShow = z.object({
  capabilities: z.array(z.string()).optional(),
  model_info: z.record(z.string(), z.unknown()).optional(),
});

/** One Ollama model from its /api/show reply; null for embedding models and unusable names. */
export function ollamaModel(name: string, show: unknown): LocalModelOption | null {
  const id = localModelId('ollama', name);
  if (!modelIdSchema.safeParse(id).success) return null;
  const parsed = ollamaShow.safeParse(show);
  const capabilities = parsed.data?.capabilities ?? [];
  if (capabilities.includes('embedding') && !capabilities.includes('completion')) return null;
  const context = Object.entries(parsed.data?.model_info ?? {}).find(([key]) =>
    key.endsWith('.context_length'),
  )?.[1];
  return {
    id,
    runtime: 'ollama',
    name: name.slice(0, 160),
    contextLength: typeof context === 'number' && context > 0 ? Math.floor(context) : 0,
    vision: capabilities.includes('vision'),
    tools: capabilities.includes('tools'),
  };
}

const lmStudioList = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      type: z.string().optional(),
      max_context_length: z.number().optional(),
      capabilities: z.array(z.string()).optional(),
    }),
  ),
});

/** LM Studio's /api/v0/models, chat models only. */
export function lmStudioModels(raw: unknown): LocalModelOption[] {
  const parsed = lmStudioList.safeParse(raw);
  if (!parsed.success) return [];
  const models: LocalModelOption[] = [];
  for (const entry of parsed.data.data) {
    if (entry.type === 'embeddings') continue;
    const id = localModelId('lmstudio', entry.id);
    if (!modelIdSchema.safeParse(id).success) continue;
    models.push({
      id,
      runtime: 'lmstudio',
      name: entry.id.slice(0, 160),
      contextLength: Math.max(0, Math.floor(entry.max_context_length ?? 0)),
      vision: entry.type === 'vlm',
      tools: entry.capabilities?.includes('tool_use') ?? false,
    });
  }
  return models;
}

/** Suitable models first (images and tools), then by runtime and name. */
const order = (a: LocalModelOption, b: LocalModelOption) =>
  Number(b.vision && b.tools) - Number(a.vision && a.tools) ||
  a.runtime.localeCompare(b.runtime) ||
  a.name.localeCompare(b.name);

export class LocalModels {
  private cached?: { at: number; state: LocalModelsState };
  private pending?: Promise<LocalModelsState>;

  constructor(private readonly fetcher: typeof fetch = fetch) {}

  /** What each runtime on this Mac serves; cached briefly, `fresh` asks again. */
  list(fresh = false): Promise<LocalModelsState> {
    if (!fresh && this.cached && Date.now() - this.cached.at < CACHE_MS)
      return Promise.resolve(this.cached.state);
    this.pending ??= this.load().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  /** The model with this id, if its runtime serves it now. */
  async find(id: string) {
    return (await this.list()).models.find(model => model.id === id);
  }

  private async get(url: string, init: RequestInit = {}, ms = PROBE_MS): Promise<unknown> {
    const response = await this.fetcher(url, {
      ...init,
      signal: AbortSignal.timeout(ms),
      headers: {
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
    });
    if (!response.ok) throw new Error(`${response.status}`);
    return response.json();
  }

  private async ollama(): Promise<LocalModelOption[] | null> {
    const { base } = localRuntimes.ollama;
    let tags: z.infer<typeof ollamaTags>;
    try {
      tags = ollamaTags.parse(await this.get(`${base}/api/tags`));
    } catch {
      return null;
    }
    const shown = await Promise.all(
      tags.models.slice(0, MAX_MODELS).map(({ name }) =>
        this.get(
          `${base}/api/show`,
          { method: 'POST', body: JSON.stringify({ model: name }) },
          SHOW_MS,
        ).then(
          show => ollamaModel(name, show),
          // A model Ollama can't describe is listed, but as limited.
          () => ollamaModel(name, {}),
        ),
      ),
    );
    return shown.filter(model => model !== null);
  }

  private async lmStudio(): Promise<LocalModelOption[] | null> {
    try {
      return lmStudioModels(await this.get(`${localRuntimes.lmstudio.base}/api/v0/models`));
    } catch {
      return null;
    }
  }

  private async load() {
    const [ollama, lmstudio] = await Promise.all([this.ollama(), this.lmStudio()]);
    const state: LocalModelsState = {
      runtimes: [
        { id: 'ollama', running: ollama !== null },
        { id: 'lmstudio', running: lmstudio !== null },
      ],
      models: [...(ollama ?? []), ...(lmstudio ?? [])].sort(order).slice(0, 200),
    };
    this.cached = { at: Date.now(), state };
    return state;
  }
}
