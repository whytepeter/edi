import { z } from 'zod';

/**
 * What Edi consumed, recorded per model call or cloud reply. Costs are what OpenRouter reports
 * for each request (search included); cloud voices bill characters on the person's own plan.
 * Local speech and transcription run on the Mac and are not recorded.
 */
export const usageKindSchema = z.enum(['answer', 'page-reader', 'voice']);
export type UsageKind = z.infer<typeof usageKindSchema>;
/** `local`: a model on this Mac (Ollama or LM Studio); tokens only, never a cost. */
export const usageProviderSchema = z.enum(['openrouter', 'local', 'cartesia', 'elevenlabs']);
export type UsageProvider = z.infer<typeof usageProviderSchema>;

const count = z.number().int().nonnegative().max(1_000_000_000);

export const usageEntrySchema = z
  .object({
    kind: usageKindSchema,
    provider: usageProviderSchema,
    model: z.string().min(1).max(160),
    inputTokens: count,
    outputTokens: count,
    /** Input tokens read from the provider's prompt cache (billed at a fraction). */
    cachedTokens: count,
    /** US dollars as reported by OpenRouter; null when the provider did not say. */
    costUsd: z.number().nonnegative().max(10_000).nullable(),
    /** Characters sent to a cloud voice. */
    characters: count,
  })
  .strict();
export type UsageEntry = z.infer<typeof usageEntrySchema>;

export const usagePeriodSchema = z.union([z.literal(1), z.literal(7), z.literal(30)]);
export type UsagePeriod = z.infer<typeof usagePeriodSchema>;

const totalsSchema = z
  .object({
    calls: count,
    inputTokens: count,
    outputTokens: count,
    cachedTokens: count,
    costUsd: z.number().nonnegative(),
    /** Calls whose cost was not reported, so costUsd is a floor. */
    unpricedCalls: count,
  })
  .strict();
export type UsageTotals = z.infer<typeof totalsSchema>;

export const usageSummarySchema = z
  .object({
    days: usagePeriodSchema,
    /** OpenRouter model calls across the period. */
    total: totalsSchema,
    answers: z.number().int().nonnegative(),
    byKind: z.array(totalsSchema.extend({ kind: z.enum(['answer', 'page-reader']) })).max(2),
    byModel: z.array(totalsSchema.extend({ model: z.string().max(160) })).max(12),
    /** One entry per local day, oldest first. */
    daily: z
      .array(z.object({ day: z.string().max(10), costUsd: z.number().nonnegative() }).strict())
      .max(30),
    voice: z
      .array(
        z
          .object({
            provider: z.enum(['cartesia', 'elevenlabs']),
            replies: count,
            characters: count,
          })
          .strict(),
      )
      .max(2),
    /** The OpenRouter key's own account figures, when they could be fetched. */
    account: z
      .object({
        spentUsd: z.number().nonnegative(),
        limitUsd: z.number().nonnegative().nullable(),
        remainingUsd: z.number().nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type UsageSummary = z.infer<typeof usageSummarySchema>;

/**
 * Why a model call failed, kept on this Mac so failures can be explained: the HTTP status, the
 * provider OpenRouter used, its error code and a short message with links, addresses, quoted
 * text and long numbers removed. Never the request, the reply or the key.
 */
export const providerFailureSchema = z
  .object({
    status: z.number().int().min(0).max(999).optional(),
    provider: z.string().max(80).optional(),
    code: z.string().max(80).optional(),
    message: z.string().max(240).optional(),
    /** How many model steps had finished before it failed. */
    step: z.number().int().min(0).max(100),
  })
  .strict();
export type ProviderFailure = z.infer<typeof providerFailureSchema>;
