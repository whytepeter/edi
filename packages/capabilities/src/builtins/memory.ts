import { z } from 'zod';
import {
  maxMemories,
  memoryKindSchema,
  refuseToRemember,
  type Memory,
  type MemoryKind,
} from '@edi/contracts';
import { defineCapability } from '../types';

/**
 * What Edi keeps about the person between conversations. Nothing is kept quietly: remembering
 * and forgetting are reviewed like any other change, and everything is listed in
 * Settings → Memory, where it can be edited or removed.
 */
export function memoryCapabilities(deps: {
  /** Everything Edi remembers now, oldest first. */
  list(): Memory[];
  add(memory: { kind: MemoryKind; text: string }): Memory;
  remove(id: string): boolean;
  /** False when the person switched remembering off in Settings → Memory. */
  enabled(): boolean;
}) {
  const remember = defineCapability({
    id: 'edi.remember',
    title: 'Remember something',
    description:
      'Keep one short thing about the user between conversations: how they like something done, ' +
      'a person or project they mention often, a fact about them. Use it when they say to ' +
      'remember something, or when they tell you something that will matter next time — not for ' +
      'passing details of the task at hand. The user reviews it, and can edit or remove it later ' +
      'in Settings → Memory. Never store passwords, keys, card numbers or anything sensitive.',
    effect: 'write',
    timeoutMs: 5_000,
    input: z
      .object({
        text: z
          .string()
          .trim()
          .min(1)
          .max(400)
          .describe('One line, in the user’s own terms, e.g. “Prefers short answers, no preamble”'),
        kind: memoryKindSchema.describe(
          'preference (how they like things), fact (about them), person, or project',
        ),
      })
      .strict(),
    prepare({ text, kind }) {
      if (!deps.enabled())
        throw new Error('The user switched off remembering in Settings → Memory.');
      const refused = refuseToRemember(text);
      if (refused) throw new Error(refused);
      const already = deps
        .list()
        .find(memory => memory.text.toLowerCase() === text.trim().toLowerCase());
      if (already) throw new Error(`Edi already remembers that: “${already.text}”.`);
      if (deps.list().length >= maxMemories)
        throw new Error(
          `Edi already remembers ${maxMemories} things. Ask the user which to drop, then use edi_forget.`,
        );
      return {
        preview: {
          title: 'Remember this',
          action: 'Remember',
          summary: `Remember: “${text}”.`,
          fields: [{ label: 'Kind', value: kind }],
        },
        async execute() {
          const saved = deps.add({ kind, text });
          return {
            summary: `Remembered: “${saved.text}”.`,
            output: { id: saved.id, shownIn: 'Settings → Memory' },
          };
        },
      };
    },
  });

  const forget = defineCapability({
    id: 'edi.forget',
    title: 'Forget something',
    description:
      'Stop keeping one thing Edi remembers, by the words it remembers (they are listed in the ' +
      'setup data). Use it when the user says to forget something, or corrects it — forget the ' +
      'old line, then save the new one with edi_remember.',
    effect: 'write',
    timeoutMs: 5_000,
    input: z
      .object({
        text: z
          .string()
          .trim()
          .min(1)
          .max(400)
          .describe('The remembered line, or enough of it to pick it out'),
      })
      .strict(),
    prepare({ text }) {
      const wanted = text.trim().toLowerCase();
      const matches = deps
        .list()
        .filter(
          memory =>
            memory.text.toLowerCase().includes(wanted) ||
            wanted.includes(memory.text.toLowerCase()),
        );
      if (!matches.length) throw new Error(`Edi doesn’t remember anything like “${text}”.`);
      if (matches.length > 1)
        throw new Error(
          `Several match “${text}”: ${matches
            .slice(0, 5)
            .map(memory => `“${memory.text}”`)
            .join(', ')}. Ask the user which one.`,
        );
      const target = matches[0]!;
      return {
        preview: {
          title: 'Forget this',
          action: 'Forget',
          summary: `Forget: “${target.text}”.`,
          fields: [],
        },
        async execute() {
          const gone = deps.remove(target.id);
          return {
            summary: gone ? `Forgotten: “${target.text}”.` : 'Edi no longer remembered that.',
            output: { forgotten: gone },
          };
        },
      };
    },
  });

  return [remember, forget] as const;
}
