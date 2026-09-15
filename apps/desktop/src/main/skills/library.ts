import { randomUUID } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  formatSkill,
  parseSkill,
  skillNameSchema,
  type SkillDefinition,
  type SkillTrust,
} from '@edi/contracts';

export interface AvailableSkill extends SkillDefinition {
  trust: SkillTrust;
  enabled: boolean;
  /** Its folder has helper scripts; Edi follows the instructions only and never runs them. */
  helperScripts?: boolean;
}

const SCRIPT = /\.(sh|bash|zsh|command|py|js|mjs|cjs|ts|rb|pl|php|applescript|scpt)$/i;

/** Agent Skills may bundle scripts (usually in `scripts/`), which Edi never runs. */
async function hasHelperScripts(folder: string) {
  try {
    const entries = await readdir(folder, { withFileTypes: true });
    return entries.some(
      entry =>
        (entry.isDirectory() && entry.name === 'scripts') ||
        (entry.isFile() && SCRIPT.test(entry.name)),
    );
  } catch {
    return false;
  }
}

/** A skill folder the person added that couldn't be read, and why. */
export interface SkillIssue {
  folder: string;
  message: string;
}

/**
 * Every skill Edi can use: those by Fewerlabs that ship with it, and the person's own in
 * Documents › Edi › Skills (made with Skill Creator, or a folder someone shared). The folder is
 * read again whenever it's listed, so a skill added or edited in Finder shows up without a
 * restart, and every file passes the same check. A skill with a built-in name is ignored.
 */
export class SkillLibrary {
  private yours: SkillDefinition[] = [];
  private issues: SkillIssue[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly options: {
      builtIn: readonly SkillDefinition[];
      /** Documents › Edi › Skills. */
      folder: () => string;
      /** Names the person switched off. */
      off: () => readonly string[];
      setOff(names: string[]): Promise<void> | void;
      /** Moves a removed skill's folder to the Trash; deleted outright when absent (tests). */
      trash?: (path: string) => Promise<void>;
    },
  ) {}

  /** Names of the person's skills whose folders have helper scripts. */
  private scripted = new Set<string>();

  /** Reads the person's skills folder again. */
  async refresh() {
    const yours: SkillDefinition[] = [];
    const issues: SkillIssue[] = [];
    const scripted = new Set<string>();
    let entries: Dirent[] = [];
    try {
      entries = await readdir(this.options.folder(), { withFileTypes: true });
    } catch {
      // No folder yet: nothing of theirs.
    }
    const builtIn = new Set(this.options.builtIn.map(skill => skill.name));
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const folder = entry.name;
      if (folder.startsWith('.') || !(entry.isDirectory() || entry.isSymbolicLink())) continue;
      const path = join(this.options.folder(), folder);
      let text: string;
      try {
        text = await readFile(join(path, 'SKILL.md'), 'utf8');
      } catch {
        // Still being copied, or not a skill: say so instead of leaving it unexplained.
        issues.push({ folder, message: 'There’s no SKILL.md in this folder yet.' });
        continue;
      }
      const { skill, problems } = parseSkill(text, { folderName: folder });
      if (!skill) issues.push({ folder, message: problems[0]?.message ?? 'Unreadable.' });
      else if (builtIn.has(skill.name))
        issues.push({ folder, message: 'A skill by Fewerlabs already has this name.' });
      else {
        yours.push(skill);
        if (await hasHelperScripts(path)) scripted.add(skill.name);
      }
    }
    this.yours = yours;
    this.issues = issues;
    this.scripted = scripted;
    this.publish();
  }

  list(): AvailableSkill[] {
    const off = new Set(this.options.off());
    return [
      ...this.options.builtIn.map(skill => ({ ...skill, trust: 'fewerlabs' as const })),
      ...this.yours.map(skill => ({
        ...skill,
        trust: 'local' as const,
        ...(this.scripted.has(skill.name) ? { helperScripts: true } : {}),
      })),
    ].map(skill => ({ ...skill, enabled: !off.has(skill.name) }));
  }

  /** Skills the model may use now. */
  enabled() {
    return this.list().filter(skill => skill.enabled);
  }

  get(name: string) {
    return this.list().find(skill => skill.name === name);
  }

  problems() {
    return this.issues;
  }

  async setEnabled(name: string, enabled: boolean) {
    if (!this.get(name)) throw new Error('That skill isn’t available.');
    const off = new Set(this.options.off());
    if (enabled) off.delete(name);
    else off.add(name);
    await this.options.setOff([...off]);
    this.publish();
  }

  /**
   * Save one of the person's skills (new, or replacing their own with the same name). Skills by
   * Fewerlabs can't be replaced. The file appears whole or not at all.
   */
  async save(skill: {
    name: string;
    title: string;
    description: string;
    body: string;
    apps?: string[];
    examples?: string[];
    category?: string;
  }) {
    const name = skillNameSchema.parse(skill.name);
    if (this.options.builtIn.some(entry => entry.name === name))
      throw new Error('A skill by Fewerlabs has that name. Choose another name.');
    const text = formatSkill({ ...skill, name });
    const { skill: checked, problems } = parseSkill(text, { folderName: name });
    if (!checked) throw new Error(problems[0]?.message ?? 'That skill isn’t valid.');
    const replaced = this.yours.some(entry => entry.name === name);
    const folder = join(this.options.folder(), name);
    await mkdir(folder, { recursive: true });
    const temp = join(folder, `.edi-${randomUUID()}.tmp`);
    await writeFile(temp, text, { flag: 'wx', mode: 0o644 });
    try {
      await rename(temp, join(folder, 'SKILL.md'));
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
    await this.refresh();
    return { path: join(folder, 'SKILL.md'), replaced };
  }

  /** Deletes one of the person's skills; the Skills page confirms first. */
  async remove(name: string) {
    const skill = this.get(name);
    if (!skill || skill.trust === 'fewerlabs')
      throw new Error('Only your own skills can be removed.');
    const folder = join(this.options.folder(), skillNameSchema.parse(name));
    if (this.options.trash) await this.options.trash(folder);
    else await rm(folder, { recursive: true, force: true });
    await this.refresh();
  }

  onChange(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish() {
    for (const listener of this.listeners) listener();
  }
}
