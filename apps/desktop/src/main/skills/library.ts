import { randomUUID } from 'node:crypto';
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

  /** Reads the person's skills folder again. */
  async refresh() {
    const yours: SkillDefinition[] = [];
    const issues: SkillIssue[] = [];
    let names: string[] = [];
    try {
      names = await readdir(this.options.folder());
    } catch {
      // No folder yet: nothing of theirs.
    }
    const builtIn = new Set(this.options.builtIn.map(skill => skill.name));
    for (const folder of names.sort()) {
      if (folder.startsWith('.')) continue;
      let text: string;
      try {
        text = await readFile(join(this.options.folder(), folder, 'SKILL.md'), 'utf8');
      } catch {
        continue; // Not a skill folder.
      }
      const { skill, problems } = parseSkill(text, { folderName: folder });
      if (!skill) issues.push({ folder, message: problems[0]?.message ?? 'Unreadable.' });
      else if (builtIn.has(skill.name))
        issues.push({ folder, message: 'A skill by Fewerlabs already has this name.' });
      else yours.push(skill);
    }
    this.yours = yours;
    this.issues = issues;
    this.publish();
  }

  list(): AvailableSkill[] {
    const off = new Set(this.options.off());
    return [
      ...this.options.builtIn.map(skill => ({ ...skill, trust: 'fewerlabs' as const })),
      ...this.yours.map(skill => ({ ...skill, trust: 'local' as const })),
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
