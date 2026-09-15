import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatSkill, parseSkill } from '../../packages/contracts/src/index';
import { SkillLibrary } from '../../apps/desktop/src/main/skills/library';
import { skillCapabilities } from '../../apps/desktop/src/main/skills/capabilities';

const context = {
  callId: '00000000-0000-4000-8000-000000000001',
  runId: '00000000-0000-4000-8000-000000000002',
};
const live = () => new AbortController().signal;
const skillsRoot = join(import.meta.dirname, '../../packages/skills');

test('a SKILL.md is read the Agent Skills way, and problems are explained', () => {
  const { skill } = parseSkill(
    [
      '---',
      'name: weekly-update',
      'description: >',
      '  Writes my weekly update.',
      '  Use when I ask for my weekly update.',
      'license: MIT',
      'metadata:',
      '  title: "Weekly Update"',
      '  author: Sam',
      '  apps: gmail slack',
      '  category: "Your day"',
      '  icon: calendar',
      '  examples: "Write my update | What did I ship?"',
      '---',
      '',
      '# Weekly Update',
      'Steps.',
    ].join('\n'),
    { folderName: 'weekly-update' },
  );
  assert.deepEqual(skill, {
    name: 'weekly-update',
    title: 'Weekly Update',
    description: 'Writes my weekly update. Use when I ask for my weekly update.',
    author: 'Sam',
    version: '',
    license: 'MIT',
    apps: ['gmail', 'slack'],
    category: 'Your day',
    icon: 'calendar',
    examples: ['Write my update', 'What did I ship?'],
    body: '# Weekly Update\nSteps.',
  });

  const problems = (text: string, folderName?: string) =>
    parseSkill(text, folderName ? { folderName } : {}).problems.map(problem => problem.message);
  assert.match(problems('no frontmatter')[0]!, /frontmatter/);
  assert.match(problems('---\nname: Bad Name\ndescription: x\n---\nbody')[0]!, /lowercase/);
  assert.match(problems('---\nname: a\ndescription: x\n---\nbody', 'b')[0]!, /named a/);
  assert.match(problems('---\nname: a\n---\nbody')[0]!, /description/);
  assert.match(problems('---\nname: a\ndescription: x\n---\n')[0]!, /instructions/);

  // What Skill Creator writes reads back the same, quotes and new lines included.
  const written = formatSkill({
    name: 'quote-test',
    title: 'Quote "Test"',
    description: 'Says "hi".\nUse when greeting.',
    body: 'Do it.',
    apps: ['gmail'],
    examples: ['Say hi | wave', 'Greet Sam'],
  });
  const back = parseSkill(written, { folderName: 'quote-test' }).skill!;
  assert.equal(back.title, 'Quote "Test"');
  assert.equal(back.description, 'Says "hi".\nUse when greeting.');
  assert.equal(back.author, 'You');
  assert.deepEqual(back.apps, ['gmail']);
  assert.deepEqual(back.examples, ['Say hi / wave', 'Greet Sam']);
});

test('every skill by Fewerlabs passes the same check, with a title and author', async () => {
  const folders = (await readdir(skillsRoot, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && entry.name !== 'node_modules')
    .map(entry => entry.name);
  assert.deepEqual(folders.sort(), [
    'daily-brief',
    'developer-companion',
    'meeting-prep',
    'skill-creator',
  ]);
  for (const folder of folders) {
    const text = await readFile(join(skillsRoot, folder, 'SKILL.md'), 'utf8');
    const { skill, problems } = parseSkill(text, { folderName: folder });
    assert.ok(skill, `${folder}: ${problems.map(problem => problem.message).join('; ')}`);
    assert.equal(skill.author, 'Fewerlabs');
    assert.match(skill.description, /Use when/);
    assert.ok(
      skill.category && skill.icon && skill.examples.length > 0,
      `${folder} needs category, icon, examples`,
    );
    assert.ok(skill.body.split('\n').length < 200, `${folder} is too long`);
  }
});

const builtIn = parseSkill(
  '---\nname: daily-brief\ndescription: Plans the day. Use when asked.\nmetadata:\n  author: Fewerlabs\n---\nPlan it.',
).skill!;

async function library() {
  const folder = await mkdtemp(join(tmpdir(), 'edi-skills-'));
  let off: string[] = [];
  const skills = new SkillLibrary({
    builtIn: [builtIn],
    folder: () => folder,
    off: () => off,
    setOff: names => {
      off = names;
    },
  });
  const put = async (name: string, text: string) => {
    await mkdir(join(folder, name), { recursive: true });
    await writeFile(join(folder, name, 'SKILL.md'), text);
  };
  return { folder, skills, put, off: () => off };
}

test('the person’s own skills come from their folder, checked, never replacing a built-in one', async () => {
  const { folder, skills, put, off } = await library();
  await put(
    'weekly-update',
    '---\nname: weekly-update\ndescription: Weekly. Use when asked.\n---\nDo it.',
  );
  await put('broken', '---\nname: broken\n---\nno description');
  await put('daily-brief', '---\nname: daily-brief\ndescription: Mine. Use when.\n---\nMine.');
  await mkdir(join(folder, 'not-a-skill'), { recursive: true });
  await skills.refresh();

  assert.deepEqual(
    skills.list().map(skill => [skill.name, skill.trust, skill.enabled]),
    [
      ['daily-brief', 'fewerlabs', true],
      ['weekly-update', 'local', true],
    ],
  );
  assert.equal(skills.get('daily-brief')?.body, 'Plan it.');
  assert.deepEqual(
    skills.problems().map(problem => problem.folder),
    ['broken', 'daily-brief'],
  );

  await skills.setEnabled('daily-brief', false);
  assert.deepEqual(off(), ['daily-brief']);
  assert.deepEqual(
    skills.enabled().map(skill => skill.name),
    ['weekly-update'],
  );
  await assert.rejects(skills.remove('daily-brief'), /Only your own skills/);
  await skills.remove('weekly-update');
  assert.equal(skills.get('weekly-update'), undefined);
});

test('skills_use loads a skill’s instructions; skills_create saves the person’s skill after review', async () => {
  const { folder, skills } = await library();
  await skills.refresh();
  const [use, create] = skillCapabilities(skills);
  assert.equal(use.effect, 'read');
  assert.equal(create.effect, 'write');

  const loaded = await (await use.prepare({ name: 'daily-brief' }, context)).execute(live());
  assert.deepEqual(
    { ...(loaded.output as Record<string, unknown>), note: undefined },
    { skill: 'Daily Brief', by: 'Fewerlabs', instructions: 'Plan it.', note: undefined },
  );

  const input = create.input.parse({
    name: 'weekly-update',
    title: 'Weekly Update',
    description: 'Writes my weekly update. Use when I ask for it.',
    instructions: '1. Look at my calendar.\n2. Show the update.',
    apps: ['gmail'],
  });
  const saving = await create.prepare(input, context);
  assert.equal(saving.preview.action, 'Save Skill');
  // Nothing is written until the person approves and it runs.
  assert.deepEqual(await readdir(folder), []);
  await saving.execute(live());
  const saved = skills.get('weekly-update');
  assert.equal(saved?.trust, 'local');
  assert.equal(saved?.body, '1. Look at my calendar.\n2. Show the update.');

  const again = await create.prepare({ ...input, instructions: 'New steps.' }, context);
  assert.equal(again.preview.action, 'Update Skill');
  const result = await again.execute(live());
  assert.match(result.summary, /Updated/);
  assert.equal(skills.get('weekly-update')?.body, 'New steps.');

  await assert.rejects(
    async () => create.prepare({ ...input, name: 'daily-brief' }, context),
    /Fewerlabs has that name/,
  );
  await skills.setEnabled('daily-brief', false);
  await assert.rejects(async () => use.prepare({ name: 'daily-brief' }, context), /switched off/);
});
