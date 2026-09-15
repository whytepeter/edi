import { z } from 'zod';

/**
 * Skills teach Edi ways of working. A skill is an Agent Skills folder
 * (https://agentskills.io/specification): `SKILL.md` with YAML frontmatter and Markdown
 * instructions. Edi reads the frontmatter it needs and the Markdown; it never runs a skill's
 * scripts, and a skill cannot grant itself tools, apps or permissions. Edi-specific details live
 * in the spec's `metadata` map:
 *
 * - `title`: the name people see ("Meeting Prep"); defaults to the name, title-cased
 * - `author`, `version`: shown on the Skills page
 * - `apps`: connected apps that make it better, space-separated catalog ids ("gmail slack")
 * - `category`: the group it's listed under ("Your day", "Development")
 * - `icon`: an Edi icon name ("calendar", "code"); anything unknown shows the default
 * - `examples`: requests to try, separated by `|` ("What’s my day like? | Plan tomorrow")
 */

export const skillNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single hyphens');

/** Who stands behind a skill; built-in ones are made by Fewerlabs. */
export const skillTrustSchema = z.enum(['fewerlabs', 'verified', 'community', 'local']);
export type SkillTrust = z.infer<typeof skillTrustSchema>;

export interface SkillDefinition {
  name: string;
  title: string;
  description: string;
  author: string;
  version: string;
  license: string;
  /** Catalog ids of connected apps that help. */
  apps: string[];
  category: string;
  icon: string;
  /** Requests to try, as the person would say them. */
  examples: string[];
  /** The Markdown instructions after the frontmatter. */
  body: string;
}

export interface SkillProblem {
  message: string;
}

const MAX_BODY = 30_000;
const MAX_FILE = 40_000;

/** Frontmatter as far as skills use it: scalars, block scalars, and one level of `metadata`. */
function parseFrontmatter(text: string): {
  fields: Map<string, string>;
  metadata: Map<string, string>;
} {
  const fields = new Map<string, string>();
  const metadata = new Map<string, string>();
  const lines = text.split('\n');
  const unquote = (value: string) => {
    const trimmed = value.trim();
    if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
      try {
        return String(JSON.parse(trimmed));
      } catch {
        // Not JSON-style escaping; fall through to the plain unquote.
      }
    }
    if (
      trimmed.length >= 2 &&
      ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'")))
    )
      return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/''/g, "'");
    return trimmed;
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.replace(/\r$/, '');
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!match)
      throw new Error(`Couldn’t read this frontmatter line: “${line.trim().slice(0, 60)}”`);
    const [, key, rest] = match as unknown as [string, string, string];
    if (key === 'metadata' && !rest.trim()) {
      while (index + 1 < lines.length && /^\s+\S/.test(lines[index + 1]!)) {
        const entry = /^\s+([A-Za-z][\w.-]*):\s*(.*)$/.exec(lines[++index]!.replace(/\r$/, ''));
        if (entry) metadata.set(entry[1]!, unquote(entry[2]!));
      }
      continue;
    }
    if (
      rest.trim() === '>' ||
      rest.trim() === '|' ||
      rest.trim() === '>-' ||
      rest.trim() === '|-'
    ) {
      const block: string[] = [];
      while (
        index + 1 < lines.length &&
        (/^\s+\S/.test(lines[index + 1]!) || !lines[index + 1]!.trim())
      )
        block.push(lines[++index]!.trim());
      fields.set(key, (rest.trim().startsWith('>') ? block.join(' ') : block.join('\n')).trim());
      continue;
    }
    fields.set(key, unquote(rest));
  }
  return { fields, metadata };
}

const titleCase = (name: string) =>
  name
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

/**
 * Read and check a `SKILL.md`. `folderName`, when given, must match the skill's name (as the
 * spec requires). Problems are returned, never thrown, so the Skills page can say what's wrong.
 */
export function parseSkill(
  text: string,
  options: { folderName?: string } = {},
): { skill?: SkillDefinition; problems: SkillProblem[] } {
  const problems: SkillProblem[] = [];
  if (text.length > MAX_FILE) return { problems: [{ message: 'SKILL.md is too long.' }] };
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text.replace(/^\uFEFF/, ''));
  if (!match) return { problems: [{ message: 'SKILL.md needs frontmatter between --- lines.' }] };
  let parsed;
  try {
    parsed = parseFrontmatter(match[1]!);
  } catch (error) {
    return { problems: [{ message: (error as Error).message }] };
  }
  const { fields, metadata } = parsed;
  const name = skillNameSchema.safeParse(fields.get('name') ?? '');
  if (!name.success)
    problems.push({ message: `Name: ${name.error.issues[0]?.message ?? 'missing'}.` });
  else if (options.folderName && options.folderName !== name.data)
    problems.push({ message: `The folder must be named ${name.data}.` });
  const description = (fields.get('description') ?? '').trim();
  if (!description)
    problems.push({ message: 'Add a description of what it does and when to use it.' });
  if (description.length > 1024)
    problems.push({ message: 'The description is over 1024 characters.' });
  const body = match[2]!.trim();
  if (!body) problems.push({ message: 'Add the instructions after the frontmatter.' });
  if (body.length > MAX_BODY) problems.push({ message: 'The instructions are too long.' });
  if (problems.length || !name.success) return { problems };
  const apps = (metadata.get('apps') ?? '')
    .split(/[\s,]+/)
    .filter(app => /^[a-z0-9_]{1,40}$/.test(app))
    .slice(0, 12);
  return {
    skill: {
      name: name.data,
      title: (metadata.get('title') || titleCase(name.data)).slice(0, 60),
      description,
      author: (metadata.get('author') ?? '').slice(0, 60),
      version: (metadata.get('version') ?? '').slice(0, 20),
      license: (fields.get('license') ?? '').slice(0, 120),
      apps,
      category: (metadata.get('category') ?? '').slice(0, 40),
      icon: /^[a-z-]{1,30}$/.test(metadata.get('icon') ?? '') ? metadata.get('icon')! : '',
      examples: (metadata.get('examples') ?? '')
        .split('|')
        .map(example => example.trim().slice(0, 120))
        .filter(Boolean)
        .slice(0, 5),
      body,
    },
    problems,
  };
}

/** Writes the `SKILL.md` for a skill made in Edi, in the same format it reads. */
export function formatSkill(skill: {
  name: string;
  title: string;
  description: string;
  body: string;
  apps?: string[];
  examples?: string[];
  category?: string;
}) {
  const quote = (value: string) => JSON.stringify(value);
  return [
    '---',
    `name: ${skill.name}`,
    `description: ${quote(skill.description)}`,
    'metadata:',
    `  title: ${quote(skill.title)}`,
    `  author: ${quote('You')}`,
    ...(skill.category ? [`  category: ${quote(skill.category)}`] : []),
    ...(skill.apps?.length ? [`  apps: ${quote(skill.apps.join(' '))}`] : []),
    ...(skill.examples?.length
      ? [
          `  examples: ${quote(skill.examples.map(example => example.replace(/\|/g, '/')).join(' | '))}`,
        ]
      : []),
    '---',
    '',
    skill.body.trim(),
    '',
  ].join('\n');
}

/** A skill as the Skills page shows it. */
export const skillSummarySchema = z
  .object({
    name: skillNameSchema,
    title: z.string().max(60),
    description: z.string().max(1024),
    author: z.string().max(60),
    version: z.string().max(20),
    trust: skillTrustSchema,
    enabled: z.boolean(),
    license: z.string().max(120),
    category: z.string().max(40),
    icon: z.string().max(30),
    examples: z.array(z.string().max(120)).max(5),
    /** The instructions Edi follows, shown on the skill's page. */
    instructions: z.string().max(30_000),
    /** Its folder has helper scripts; Edi follows the instructions only and never runs them. */
    helperScripts: z.boolean().optional(),
    /** Connected apps that help, and whether each is connected now. */
    apps: z
      .array(
        z
          .object({ id: z.string().max(40), name: z.string().max(60), connected: z.boolean() })
          .strict(),
      )
      .max(12),
  })
  .strict();
export type SkillSummary = z.infer<typeof skillSummarySchema>;
export const skillListSchema = z.array(skillSummarySchema).max(200);

/** Everything the Skills page shows, including skill folders that couldn't be read. */
export const skillsStateSchema = z
  .object({
    skills: skillListSchema,
    issues: z
      .array(z.object({ folder: z.string().max(200), message: z.string().max(300) }).strict())
      .max(50),
  })
  .strict();
export type SkillsState = z.infer<typeof skillsStateSchema>;
