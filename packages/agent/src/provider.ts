import type { LanguageModel, ProviderMetadata, streamText, ToolSet } from 'ai';
import type { UsageProvider } from '@edi/contracts';
import type { AgentInput } from './protocol';

export type ProviderOptions = NonNullable<Parameters<typeof streamText>[0]['providerOptions']>;

/**
 * Where the brain's model calls go. The engine knows nothing about a particular service: a host
 * hands it one of these (OpenRouter today; anything the AI SDK can talk to, including a model
 * on the same machine) and every call, option and cost goes through it.
 */
export interface ModelProvider {
  /** The name usage is recorded under. */
  usage: UsageProvider;
  /** A model for one call, by the id the run was started with. */
  model(id: string): LanguageModel;
  /**
   * Tools the provider runs itself, by the name the model calls. `web_search` is understood by
   * the engine: its results become links the run may read and a visible "searching" step.
   */
  serverTools?(): ToolSet;
  /** Provider options for the answering call (routing, how much to think). */
  options?(input: Pick<AgentInput, 'reasoningEffort' | 'spoken' | 'mode'>): ProviderOptions;
  /** What one call cost in US dollars, when the provider reports it. */
  cost?(metadata: ProviderMetadata | undefined): number | null;
  /** Values that must never appear in a failure summary (an API key). */
  secrets?: readonly string[];
}
