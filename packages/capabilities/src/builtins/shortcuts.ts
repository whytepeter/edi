import { z } from 'zod';
import { defineCapability } from '../types';

/**
 * The person's own shortcuts, from the Shortcuts app. They wrote them, so the steps are theirs;
 * Edi only starts one, by exact name, after they review it. A shortcut can do anything their Mac
 * can, so running one is never automatic and never covered by a schedule that runs on its own.
 */
export function shortcutsCapabilities(deps: {
  /** Their shortcuts, by name. */
  list(): Promise<string[]>;
  /** Runs one and returns whatever it gives back, as text. */
  run(name: string, input: string | undefined, signal: AbortSignal): Promise<string>;
}) {
  const nameInput = z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe('The shortcut’s name, exactly as shortcuts_list gives it');

  const list = defineCapability({
    id: 'shortcuts.list',
    title: 'Check shortcuts',
    description:
      'List the shortcuts the user made in the Shortcuts app, by name. Use it when they ask what ' +
      'shortcuts they have, or before running one, so the name is exact.',
    effect: 'read',
    timeoutMs: 10_000,
    input: z.object({}).strict(),
    prepare() {
      return {
        preview: {
          title: 'Check shortcuts',
          action: 'Check',
          summary: 'List the shortcuts on this Mac.',
          fields: [],
        },
        async execute() {
          const names = await deps.list();
          return {
            summary: names.length
              ? `Found ${names.length} ${names.length === 1 ? 'shortcut' : 'shortcuts'}.`
              : 'No shortcuts on this Mac.',
            output: { shortcuts: names },
          };
        },
      };
    },
  });

  const run = defineCapability({
    id: 'shortcuts.run',
    title: 'Run a shortcut',
    description:
      'Run one of the user’s own shortcuts from the Shortcuts app, by its exact name, and read ' +
      'back whatever it returns. Use it when they ask for one by name (“run my Focus shortcut”) ' +
      'or when a shortcut clearly does what they asked. Pass input only when the shortcut takes ' +
      'some. The user reviews every run.',
    effect: 'write',
    timeoutMs: 120_000,
    input: z
      .object({
        name: nameInput,
        input: z
          .string()
          .max(4_000)
          .optional()
          .describe('Text to hand the shortcut, when it takes an input'),
      })
      .strict(),
    async prepare({ name, input }) {
      const names = await deps.list();
      const match = names.find(entry => entry.toLowerCase() === name.trim().toLowerCase());
      if (!match) {
        const wanted = name.trim().toLowerCase();
        const near = names.filter(
          entry => entry.toLowerCase().includes(wanted) || wanted.includes(entry.toLowerCase()),
        );
        throw new Error(
          near.length
            ? `There's no shortcut called “${name}”. Did they mean ${near
                .slice(0, 5)
                .map(entry => `“${entry}”`)
                .join(', ')}?`
            : `There's no shortcut called “${name}”. Use shortcuts_list to see what they have.`,
        );
      }
      return {
        // "Always allow" applies to this one shortcut, never to shortcuts in general.
        scope: { kind: 'app', value: match, label: `the “${match}” shortcut`, covers: [match] },
        preview: {
          title: 'Run a shortcut',
          action: 'Run',
          summary: `Run “${match}” in Shortcuts.`,
          fields: input ? [{ label: 'With', value: input.slice(0, 200) }] : [],
        },
        async execute(signal) {
          const result = (await deps.run(match, input, signal)).trim();
          return {
            summary: `Ran “${match}”.`,
            output: {
              shortcut: match,
              ...(result ? { result } : { result: '', note: 'It returned nothing.' }),
            },
          };
        },
      };
    },
  });

  return [list, run] as const;
}
