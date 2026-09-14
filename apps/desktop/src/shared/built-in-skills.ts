import { parseSkill, type SkillDefinition } from '@edi/contracts';
import dailyBrief from '@edi/skills/daily-brief/SKILL.md?raw';
import developerCompanion from '@edi/skills/developer-companion/SKILL.md?raw';
import meetingPrep from '@edi/skills/meeting-prep/SKILL.md?raw';
import skillCreator from '@edi/skills/skill-creator/SKILL.md?raw';

/**
 * Skills by Fewerlabs that ship with Edi. They pass the same check as anyone's skill; a broken
 * one is a build mistake, so it fails loudly.
 */
export const builtInSkills: SkillDefinition[] = [
  ['daily-brief', dailyBrief],
  ['developer-companion', developerCompanion],
  ['meeting-prep', meetingPrep],
  ['skill-creator', skillCreator],
].map(([folderName, text]) => {
  const { skill, problems } = parseSkill(text!, { folderName });
  if (!skill)
    throw new Error(
      `Built-in skill ${folderName} is invalid: ${problems.map(p => p.message).join('; ')}`,
    );
  return skill;
});
