import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { ModelProvider } from './provider';

/**
 * OpenRouter with the person's own key. Every call asks for its cost. Anthropic models also
 * cache the repeated prompt prefix (instructions, history, screenshots) across the steps of a
 * run and between nearby questions, so later steps read it at a tenth of the price; other
 * providers cache automatically. Search is read-only and runs on OpenRouter, on the same key.
 */
export function openRouterProvider(options: { apiKey: string }): ModelProvider {
  const openrouter = createOpenRouter({ apiKey: options.apiKey });
  return {
    usage: 'openrouter',
    model: id =>
      openrouter(id, {
        usage: { include: true },
        ...(id.startsWith('anthropic/') ? { cache_control: { type: 'ephemeral' as const } } : {}),
      }),
    serverTools: () => ({
      web_search: openrouter.tools.webSearch({ engine: 'auto', maxResults: 5 }),
    }),
    // OpenRouter already routes across providers. Spoken turns think as little as the model
    // allows, so the first word comes sooner.
    options: input => ({
      openrouter: {
        provider: { allow_fallbacks: true },
        ...(input.reasoningEffort ? { reasoning: { effort: input.reasoningEffort } } : {}),
      },
    }),
    cost: metadata => {
      const cost = (metadata?.openrouter as { usage?: { cost?: unknown } } | undefined)?.usage
        ?.cost;
      return typeof cost === 'number' && cost >= 0 && cost <= 10_000 ? cost : null;
    },
    secrets: [options.apiKey],
  };
}
