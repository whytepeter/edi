import { useEffect, useMemo, useState } from 'react';
import type { Command, SkillSummary, SkillsState } from '@edi/contracts';
import {
  Button,
  GroupedList,
  GroupedRow,
  Icon,
  SegmentedControl,
  Switch,
  isIconName,
  type IconName,
} from '../../components/ui';
import { BrandIcon } from '../../components/BrandIcon';
import './skills.css';

type Segment = 'Fewerlabs' | 'Yours' | 'Community';
const segments: readonly Segment[] = ['Fewerlabs', 'Yours', 'Community'];

/** Categories in the order people reach for them; any others follow alphabetically. */
const categoryOrder = [
  'Your day',
  'Development',
  'Research',
  'Writing',
  'Learning',
  'Organizing',
  'Travel',
  'Make your own',
];

type Send = (command: Command, failure: string) => Promise<boolean>;

function useSkills() {
  const [state, setState] = useState<SkillsState | null>(null);
  useEffect(() => {
    if (!window.edi) return;
    let alive = true;
    void window.edi
      .skills()
      .then(next => alive && setState(next))
      .catch(() => alive && setState({ skills: [], issues: [] }));
    const unsubscribe = window.edi.onSkills(next => alive && setState(next));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  return state;
}

const iconOf = (skill: SkillSummary): IconName =>
  isIconName(skill.icon) ? skill.icon : 'sparkles';

const madeBy = (skill: SkillSummary) =>
  skill.trust === 'fewerlabs'
    ? 'By Fewerlabs'
    : skill.trust === 'local'
      ? skill.author && skill.author !== 'You'
        ? `By ${skill.author}`
        : 'Made by you'
      : `By ${skill.author || 'the community'}`;

/** Skills grouped by category, in a stable, sensible order. */
function grouped(skills: SkillSummary[]) {
  const groups = new Map<string, SkillSummary[]>();
  for (const skill of skills) {
    const category = skill.category || 'Other';
    groups.set(category, [...(groups.get(category) ?? []), skill]);
  }
  const rank = (category: string) => {
    const index = categoryOrder.indexOf(category);
    return index === -1 ? categoryOrder.length : index;
  };
  return [...groups.entries()].sort(
    ([a], [b]) =>
      rank(a) - rank(b) || (a === 'Other' ? 1 : b === 'Other' ? -1 : a.localeCompare(b)),
  );
}

function SkillList({ skills, onOpen }: { skills: SkillSummary[]; onOpen: (name: string) => void }) {
  return (
    <>
      {grouped(skills).map(([category, entries], _index, groups) => (
        <GroupedList
          key={category}
          title={groups.length === 1 && category === 'Other' ? undefined : category}
        >
          {entries.map(skill => (
            <GroupedRow
              key={skill.name}
              icon={iconOf(skill)}
              title={skill.title}
              detail={<span className="skill-summary">{skill.description}</span>}
              value={skill.enabled ? 'On' : 'Off'}
              onOpen={() => onOpen(skill.name)}
            />
          ))}
        </GroupedList>
      ))}
    </>
  );
}

function SkillDetail({
  skill,
  onBack,
  send,
}: {
  skill: SkillSummary;
  onBack: () => void;
  send: Send;
}) {
  const [showInstructions, setShowInstructions] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function tryIt(example: string) {
    if (!(await send({ type: 'ask-agent', prompt: example }, 'Couldn’t ask Edi.'))) return;
    await send(
      { type: 'show-workspace', view: 'conversations' },
      'Couldn’t open the conversation.',
    );
  }

  return (
    <div className="skill-detail-page">
      <button type="button" className="skill-back" onClick={onBack}>
        <Icon name="back" size={14} />
        Skills
      </button>

      <header className="skill-hero">
        <span className="skill-hero-icon">
          <Icon name={iconOf(skill)} size={24} />
        </span>
        <span className="skill-hero-text">
          <h1 className="skill-hero-title">{skill.title}</h1>
          <span className="skill-hero-by">
            {skill.trust === 'fewerlabs' && <Icon name="check" size={12} />}
            {madeBy(skill)}
            {skill.version ? ` · Version ${skill.version}` : ''}
          </span>
        </span>
      </header>

      <GroupedList footer="Edi uses a skill when your request matches it. Skills never change what needs your approval.">
        <GroupedRow
          title="Use this skill"
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
      </GroupedList>

      <section className="skill-section">
        <h2 className="ds-group-title">What it does</h2>
        <p className="skill-description">{skill.description}</p>
      </section>

      {skill.examples.length > 0 && (
        <section className="skill-section">
          <h2 className="ds-group-title">Try saying</h2>
          <div className="skill-examples">
            {skill.examples.map(example => (
              <button
                key={example}
                type="button"
                className="skill-example"
                disabled={!skill.enabled}
                onClick={() => void tryIt(example)}
              >
                “{example}”
              </button>
            ))}
          </div>
        </section>
      )}

      {skill.apps.length > 0 && (
        <GroupedList
          title="Works better with"
          footer="Optional. Without them, the skill uses what Edi can reach on this Mac."
        >
          {skill.apps.map(app => (
            <GroupedRow
              key={app.id}
              leading={<BrandIcon catalogId={app.id} name={app.name} />}
              title={app.name}
              value={app.connected ? 'Connected' : undefined}
              control={
                app.connected ? undefined : (
                  <Button
                    size="small"
                    onClick={() =>
                      void send(
                        { type: 'add-connector', catalogId: app.id },
                        `Couldn’t connect ${app.name}.`,
                      )
                    }
                  >
                    Connect
                  </Button>
                )
              }
            />
          ))}
        </GroupedList>
      )}

      <GroupedList title="Details">
        <GroupedRow title="Made by" value={skill.author || '—'} />
        {skill.version && <GroupedRow title="Version" value={skill.version} />}
        {skill.license && <GroupedRow title="License" value={skill.license} />}
        <GroupedRow
          title="Instructions"
          value={showInstructions ? 'Hide' : 'Show'}
          onOpen={() => setShowInstructions(open => !open)}
        />
        {skill.trust === 'local' && (
          <GroupedRow
            title="Show in Finder"
            onOpen={() =>
              void send({ type: 'reveal-skill', name: skill.name }, 'Couldn’t show that skill.')
            }
          />
        )}
      </GroupedList>

      {showInstructions && (
        <pre className="skill-instructions" tabIndex={0}>
          {skill.instructions}
        </pre>
      )}

      {skill.trust === 'local' && (
        <div className="skill-remove-row">
          {confirming ? (
            <span className="skill-confirm">
              Move “{skill.title}” to the Trash?
              <Button
                size="small"
                onClick={() =>
                  void send(
                    { type: 'remove-skill', name: skill.name },
                    'Couldn’t remove that skill.',
                  ).then(ok => ok && onBack())
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
              Remove Skill
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Skills teach Edi ways of working. Skills by Fewerlabs ship with Edi; the person's own live in
 * Documents › Edi › Skills, made with Skill Creator or shared by someone else; community skills
 * will have their own place. Edi's built-in abilities aren't listed here, the same way Claude
 * doesn't list its built-in tools.
 */
export function SkillsView() {
  const state = useSkills();
  const [segment, setSegment] = useState<Segment>('Fewerlabs');
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState('');

  const send: Send = async (command, failure) => {
    setError('');
    try {
      await window.edi?.command(command);
      return true;
    } catch {
      setError(failure);
      return false;
    }
  };

  const skills = useMemo(() => state?.skills ?? [], [state]);
  const bySegment = useMemo(
    () => ({
      Fewerlabs: skills.filter(skill => skill.trust === 'fewerlabs' || skill.trust === 'verified'),
      Yours: skills.filter(skill => skill.trust === 'local'),
      Community: skills.filter(skill => skill.trust === 'community'),
    }),
    [skills],
  );
  const selected = open ? skills.find(skill => skill.name === open) : undefined;

  return (
    <section className="skills-page">
      {error && (
        <p role="alert" className="workspace-error">
          {error}
        </p>
      )}
      {selected ? (
        <SkillDetail skill={selected} onBack={() => setOpen(null)} send={send} />
      ) : (
        <>
          <SegmentedControl<Segment>
            label="Show skills"
            options={segments}
            value={segment}
            onChange={setSegment}
          />

          {segment === 'Fewerlabs' && (
            <>
              <p className="skills-intro">
                Ways of working made by Fewerlabs. Edi picks the right one when your request
                matches.
              </p>
              <SkillList skills={bySegment.Fewerlabs} onOpen={setOpen} />
            </>
          )}

          {segment === 'Yours' && (
            <>
              <div className="skills-yours-header">
                <p className="skills-intro">
                  Skills you made with Skill Creator, or folders someone shared, in Documents › Edi
                  › Skills.
                </p>
                <button
                  type="button"
                  className="skills-folder"
                  onClick={() =>
                    void send({ type: 'open-skills-folder' }, 'Couldn’t open the folder.')
                  }
                >
                  <Icon name="folder" size={14} />
                  Open Folder
                </button>
              </div>
              {bySegment.Yours.length > 0 ? (
                <SkillList skills={bySegment.Yours} onOpen={setOpen} />
              ) : (
                <div className="skills-empty">
                  <Icon name="sparkles" size={22} />
                  <p>
                    Ask Edi to “make a skill” for something you do often, and it will write one with
                    you.
                  </p>
                  <Button
                    size="small"
                    onClick={() => {
                      setOpen('skill-creator');
                    }}
                  >
                    About Skill Creator
                  </Button>
                </div>
              )}
              {state && state.issues.length > 0 && (
                <GroupedList title="Couldn’t load" footer="Fix the SKILL.md, then come back here.">
                  {state.issues.map(issue => (
                    <GroupedRow
                      key={issue.folder}
                      icon="info"
                      title={issue.folder}
                      detail={issue.message}
                    />
                  ))}
                </GroupedList>
              )}
              <p className="skills-note">Only add skills from people you trust.</p>
            </>
          )}

          {segment === 'Community' &&
            (bySegment.Community.length > 0 ? (
              <SkillList skills={bySegment.Community} onOpen={setOpen} />
            ) : (
              <div className="skills-empty">
                <Icon name="library" size={22} />
                <p>
                  Skills made and shared by other people will appear here. Until then, put a shared
                  skill folder in Documents › Edi › Skills and it shows up under Yours.
                </p>
              </div>
            ))}
        </>
      )}
    </section>
  );
}
