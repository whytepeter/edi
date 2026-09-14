import { z } from 'zod';

/**
 * The name the person gives their companion. It starts with a letter and holds only letters,
 * digits, spaces, apostrophes, periods and hyphens, so it is safe in copy, menus and prompts.
 */
export const assistantNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(24)
  .regex(/^\p{L}[\p{L}\p{M}\p{N} '’.-]*$/u);
