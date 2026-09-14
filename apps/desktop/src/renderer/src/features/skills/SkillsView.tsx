import { useEffect, useState } from 'react';
import type { Command, SkillSummary } from '@edi/contracts';
import { Button, GroupedList, GroupedRow, Switch, type IconName } from '../../components/ui';
import './skills.css';

/** Icons for Fewerlabs skills; everyone else's skills use sparkles. */
const skillIcon: Record<string, IconName> = {
  'developer-companion': 'code',
  'meeting-prep': 'calendar',
  'daily-brief': 'clock',
  'skill-creator': 'sparkles',
};

function useSkills() {
  const [skills, setSkills] = useState<SkillSummary[] | null>(null);
  useEffect(() => {
    if (!window.edi) return;
    let alive = true;
    void window.edi
      .skills()
      .then(list => alive && setSkills(list))
      .catch(() => alive && setSkills([]));
    const unsubscribe = window.edi.onSkills(list => alive && setSkills(list));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  return skills;
}

function SkillRow({
  skill,
  send,
}: {
  skill: SkillSummary;
  send: (command: Command, failure: string) => Promise<boolean>;
}) {
  const [confirming, setConfirming] = useState(false);
  const apps = skill.apps.length ? (
    <span className="skill-apps">
      Works with{' '}
      {skill.apps.map((app, index) => (
        <span key={app.id} data-connected={app.connected || undefined}>
          {index > 0 ? ', ' : ''}
          {app.name}
        </span>
      ))}
    </span>
  ) : null;
  return (
    <GroupedRow
      icon={skillIcon[skill.name] ?? 'sparkles'}
      title={skill.title}
      detail={
        <span className="skill-detail">
          <span className="skill-description">{skill.description}</span>
          {apps}
          {skill.trust === 'local' &&
            (confirming ? (
              <span className="skill-confirm">
                Move “{skill.title}” to the Trash?
                <Button
                  size="small"
                  onClick={() =>
                    void send(
                      { type: 'remove-skill', name: skill.name },
                      'Couldn’t remove that skill.',
                    ).then(() => setConfirming(false))
                  }
                >
                  Remove
                </Button>
                <Button size="small" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </span>
            ) : (
              <button type="button" className="skill-remove" onClick={() => setConfirming(true)}>
                Remove
              </button>
            ))}
        </span>
      }
      control={
        <Switch
          label={`Use ${skill.title}`}
          checked={skill.enabled}
          onChange={enabled =>
            void send(
              { type: 'set-skill-enabled', name: skill.name, enabled },
              'Couldn’t change that skill.',
            )
          }
        />
      }
    />
  );
}

/**
 * Skills teach Edi ways of working. Skills by Fewerlabs ship with Edi; the person's own live in
 * Documents › Edi › Skills, made with Skill Creator or shared by someone else. Edi's built-in
 * abilities aren't listed here, the same way Claude doesn't list its built-in tools.
 */
export function SkillsView() {
  const skills = useSkills();
  const [error, setError] = useState('');

  async function send(command: Command, failure: string) {
    setError('');
    try {
      await window.edi?.command(command);
      return true;
    } catch {
      setError(failure);
      return false;
    }
  }

  const fewerlabs = skills?.filter(skill => skill.trust === 'fewerlabs') ?? [];
  const yours = skills?.filter(skill => skill.trust !== 'fewerlabs') ?? [];

  return (
    <section className="skills-page">
      {error && (
        <p role="alert" className="workspace-error">
          {error}
        </p>
      )}
      <GroupedList
        title="By Fewerlabs"
        footer="Skills are instructions Edi follows when a request matches. They can’t change what needs your approval."
      >
        {fewerlabs.map(skill => (
          <SkillRow key={skill.name} skill={skill} send={send} />
        ))}
      </GroupedList>

      <div className="skills-yours">
        <div className="skills-yours-header">
          <h2 className="ds-group-title">Yours</h2>
          <button
            type="button"
            className="skills-folder"
            onClick={() => void send({ type: 'open-skills-folder' }, 'Couldn’t open the folder.')}
          >
            Open Skills Folder
          </button>
        </div>
        {yours.length > 0 ? (
          <GroupedList footer="Only add skills from people you trust.">
            {yours.map(skill => (
              <SkillRow key={skill.name} skill={skill} send={send} />
            ))}
          </GroupedList>
        ) : (
          <p className="skills-empty">
            Ask Edi to “make a skill” for something you do often, or put a skill folder someone
            shared in Documents › Edi › Skills.
          </p>
        )}
      </div>
    </section>
  );
}
