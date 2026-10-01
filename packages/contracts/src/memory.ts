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

/** Words too common to say what a question is about. */
const commonWords = new Set(
  'a an and are as at be but by can do for from have how i in is it me my of on or so that the this to was we what when where which who why will with you your'.split(
    ' ',
  ),
);
const wordsOf = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(word => word.length > 1 && !commonWords.has(word))
      // “recipes” and “recipe” are the same subject.
      .map(word => (word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word)),
  );

/**
 * The memories a turn carries, trimmed to what fits, in the order they were kept. When they don't
 * all fit, the ones that share words with the question go first, then the most recently changed.
 * Before, the oldest always won, so what the person said most recently was the first thing a turn
 * left out.
 */
export function memoriesForPrompt(
  memories: readonly Memory[],
  options: { question?: string; limit?: number } = {},
) {
  const limit = options.limit ?? memoryPromptChars;
  const line = (memory: Memory) => `- ${memory.text}`;
  const asked = wordsOf(options.question ?? '');
  const overlap = (memory: Memory) => {
    let shared = 0;
    for (const word of wordsOf(memory.text)) if (asked.has(word)) shared++;
    return shared;
  };
  const ranked = memories
    .map((memory, index) => ({ memory, index, shared: overlap(memory) }))
    .sort((a, b) => b.shared - a.shared || b.memory.updatedAt - a.memory.updatedAt);
  const chosen: typeof ranked = [];
  let used = 0;
  for (const entry of ranked) {
    const size = line(entry.memory).length + 1;
    if (used + size > limit + 1) continue;
    chosen.push(entry);
    used += size;
  }
  return chosen.sort((a, b) => a.index - b.index).map(entry => line(entry.memory));
}
