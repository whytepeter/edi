import { z } from 'zod';
import type { UsageSummary } from '@edi/contracts';

const KEY_URL = 'https://openrouter.ai/api/v1/key';
const CACHE_MS = 60_000;

const keyInfo = z.object({
  data: z.object({
    usage: z.number().nonnegative(),
    limit: z.number().nonnegative().nullable().optional(),
    limit_remaining: z.number().nullable().optional(),
  }),
});

/**
 * What OpenRouter says this key has spent and has left. Only the key is sent; failures return
 * null so the usage page still shows Edi's own records.
 */
export class OpenRouterAccount {
  private cached?: { at: number; key: string; value: UsageSummary['account'] };

  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async get(apiKey: string): Promise<UsageSummary['account']> {
    if (!apiKey) return null;
    if (this.cached && this.cached.key === apiKey && Date.now() - this.cached.at < CACHE_MS)
      return this.cached.value;
    try {
      const response = await this.fetcher(KEY_URL, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) return null;
      const { data } = keyInfo.parse(await response.json());
      const value = {
        spentUsd: data.usage,
        limitUsd: data.limit ?? null,
        remainingUsd: data.limit_remaining ?? null,
      };
      this.cached = { at: Date.now(), key: apiKey, value };
      return value;
    } catch {
      return null;
    }
  }
}
