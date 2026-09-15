import { parseSkill, type SkillDefinition } from '@edi/contracts';
import dailyBrief from '@edi/skills/daily-brief/SKILL.md?raw';
import developerCompanion from '@edi/skills/developer-companion/SKILL.md?raw';
import fileTidy from '@edi/skills/file-tidy/SKILL.md?raw';
import followUps from '@edi/skills/follow-ups/SKILL.md?raw';
import inboxTriage from '@edi/skills/inbox-triage/SKILL.md?raw';
import jobSearch from '@edi/skills/job-search/SKILL.md?raw';
import keepAnEye from '@edi/skills/keep-an-eye/SKILL.md?raw';
import meetingPrep from '@edi/skills/meeting-prep/SKILL.md?raw';
import researchReport from '@edi/skills/research-report/SKILL.md?raw';
import screenTutor from '@edi/skills/screen-tutor/SKILL.md?raw';
import skillCreator from '@edi/skills/skill-creator/SKILL.md?raw';
import studyBuddy from '@edi/skills/study-buddy/SKILL.md?raw';
import tripPlanner from '@edi/skills/trip-planner/SKILL.md?raw';
import writingCoach from '@edi/skills/writing-coach/SKILL.md?raw';

/**
 * Skills by Fewerlabs that ship with Edi. They pass the same check as anyone's skill; a broken
 * one is a build mistake, so it fails loudly.
 */
export const builtInSkills: SkillDefinition[] = [
  ['daily-brief', dailyBrief],
  ['developer-companion', developerCompanion],
  ['file-tidy', fileTidy],
  ['follow-ups', followUps],
  ['inbox-triage', inboxTriage],
  ['job-search', jobSearch],
  ['keep-an-eye', keepAnEye],
  ['meeting-prep', meetingPrep],
  ['research-report', researchReport],
  ['screen-tutor', screenTutor],
  ['skill-creator', skillCreator],
  ['study-buddy', studyBuddy],
  ['trip-planner', tripPlanner],
  ['writing-coach', writingCoach],
].map(([folderName, text]) => {
  const { skill, problems } = parseSkill(text!, { folderName });
  if (!skill)
    throw new Error(
      `Built-in skill ${folderName} is invalid: ${problems.map(p => p.message).join('; ')}`,
    );
  return skill;
});
