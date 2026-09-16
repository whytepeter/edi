import { z } from 'zod';

/**
 * What Edi keeps about the person between conversations: their preferences, the people and
 * projects they mention, how they like things done. Written only through a reviewed action,
 * listed in Settings → Memory, and editable or removable one by one.
 */
export const memoryKindSchema = z.enum(['preference', 'fact', 'person', 'project']);
export type MemoryKind = z.infer<typeof memoryKindSchema>;

export const memorySchema = z
  .object({
    id: z.string().uuid(),
    kind: memoryKindSchema,
    /** One short line, in the person's own terms. */
    text: z.string().trim().min(1).max(400),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
export type Memory = z.infer<typeof memorySchema>;
export const memoryListSchema = z.array(memorySchema).max(200);

/** How many Edi keeps, and how much of them a turn carries. */
export const maxMemories = 100;
export const memoryPromptChars = 2_000;

const secrets =
  /\b(password|passcode|pass ?phrase|api[ -]?key|secret key|access token|credit ?card|card number|cvv|iban|sort code|social security|ssn|passport number|seed phrase|private key|recovery code)\b/i;

/** Why Edi won't keep this, or null when it's fine to remember. */
export function refuseToRemember(text: string): string | null {
  if (secrets.test(text))
    return 'Edi doesn’t keep passwords, keys, card numbers or recovery codes. Those belong in your password manager.';
  return null;
}

/** The memories a turn carries, oldest first, trimmed to what fits. */
export function memoriesForPrompt(memories: readonly Memory[], limit = memoryPromptChars) {
  const lines: string[] = [];
  let used = 0;
  for (const memory of memories) {
    const line = `- ${memory.text}`;
    if (used + line.length > limit) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines;
}
