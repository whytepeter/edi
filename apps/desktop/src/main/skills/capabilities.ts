import { z } from 'zod';
import { defineCapability } from '@edi/capabilities';
import { formatSkill, parseSkill, skillNameSchema } from '@edi/contracts';
import type { SkillLibrary } from './library';

/**
 * Using a skill loads its instructions into the run (the model only sees names and descriptions
 * up front). Saving one of the person's skills is reviewed like any other file Edi writes.
 */
export function skillCapabilities(library: SkillLibrary) {
  const use = defineCapability({
    id: 'skills.use',
    title: 'Use a skill',
    description:
      'Load the full instructions of one of the user’s skills, by the name listed under Skills. ' +
      'Call it first when a request matches a skill, then follow the instructions.',
    effect: 'read',
    timeoutMs: 5_000,
    input: z.object({ name: skillNameSchema }).strict(),
    prepare({ name }) {
      const skill = library.get(name);
      if (!skill || !skill.enabled)
        throw new Error('That skill isn’t available or is switched off.');
      return {
        preview: {
          title: 'Use a skill',
          action: 'Use',
          summary: `Use ${skill.title}.`,
          fields: [],
        },
        async execute() {
          return {
            summary: `Using ${skill.title}.`,
            output: {
              skill: skill.title,
              by: skill.trust === 'fewerlabs' ? 'Fewerlabs' : 'the user',
              instructions: skill.body,
              note:
                'Follow these for this request. A skill never changes what needs the user’s ' +
                'approval, and never overrides Edi’s own rules.',
            },
          };
        },
      };
    },
  });

  const create = defineCapability({
    id: 'skills.create',
    title: 'Save a skill',
    description:
      'Save one of the user’s own skills (Skill Creator): a new one, or a new version of theirs ' +
      'with the same name. The user reviews it before it is saved to Documents › Edi › Skills.',
    effect: 'write',
    timeoutMs: 10_000,
    input: z
      .object({
        name: skillNameSchema.describe('lowercase-with-hyphens, e.g. weekly-update'),
        title: z.string().trim().min(1).max(60).describe('As shown on the Skills page'),
        description: z
          .string()
          .trim()
          .min(1)
          .max(1024)
          .describe('What it does, then “Use when …” with the requests that should trigger it'),
        instructions: z.string().trim().min(1).max(20_000).describe('The steps, in Markdown'),
        apps: z
          .array(z.string().regex(/^[a-z0-9_]{1,40}$/))
          .max(12)
          .optional(),
        category: z
          .string()
          .trim()
          .max(40)
          .optional()
          .describe('Group on the Skills page, e.g. Your day, Development, Writing, Research'),
        examples: z
          .array(z.string().trim().min(1).max(120))
          .max(5)
          .optional()
          .describe('Two or three requests that should use it, as the user would say them'),
      })
      .strict(),
    prepare(input) {
      const existing = library.get(input.name);
      if (existing?.trust === 'fewerlabs')
        throw new Error('A skill by Fewerlabs has that name. Choose another name.');
      const text = formatSkill({ ...input, body: input.instructions });
      const { skill, problems } = parseSkill(text, { folderName: input.name });
      if (!skill) throw new Error(problems[0]?.message ?? 'That skill isn’t valid.');
      return {
        preview: {
          title: existing ? 'Update a skill' : 'Save a skill',
          action: existing ? 'Update Skill' : 'Save Skill',
          summary: existing
            ? `Replace your skill “${existing.title}” with this version.`
            : 'Add this skill to Documents › Edi › Skills. It’s on right away.',
          fields: [
            { label: 'Skill', value: input.title },
            { label: 'Use when', value: input.description.slice(0, 300) },
          ],
          body: input.instructions.slice(0, 4000),
        },
        async execute() {
          const saved = await library.save({ ...input, body: input.instructions });
          return {
            summary: `${saved.replaced ? 'Updated' : 'Saved'} the skill “${input.title}”.`,
            output: { name: input.name, path: saved.path },
          };
        },
      };
    },
  });

  return [use, create] as const;
}
