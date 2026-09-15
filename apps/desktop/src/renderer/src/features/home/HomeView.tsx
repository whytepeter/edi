import { useEffect, useState, type FormEvent } from 'react';
import {
  isActiveTask,
  presentationText,
  type AgentState,
  type Connector,
  type LibraryItem,
  type CharacterDescriptor,
  type Schedule,
  type SystemInfo,
  type Task,
  type WorkspaceView,
} from '@edi/contracts';
import { GroupedList, GroupedRow, Icon } from '../../components/ui';
import { CharacterArt } from '../../components/character/CharacterArt';
import './home.css';
import { useAssistantName } from '../../hooks/useAssistantName';

interface HomeViewProps {
  character: CharacterDescriptor;
  agent: AgentState;
  system: SystemInfo | null;
  refreshKey: string;
  onOpen(view: WorkspaceView): void;
  /** Sends the question; resolves false if it could not be sent. */
  onAsk(prompt: string): Promise<boolean>;
}

function greeting(hour = new Date().getHours()) {
  if (hour < 5) return 'Still up?';
  if (hour < 12) return 'Good morning.';
  if (hour < 18) return 'Good afternoon.';
  return 'Good evening.';
}

const clip = (text: string, length = 90) =>
  text.length > length ? `${text.slice(0, length).trimEnd()}…` : text;

/** "in 20 minutes", "tomorrow at 08:00": when the next scheduled run is due. */
function when(at: number, now = Date.now()) {
  const minutes = Math.round((at - now) / 60_000);
  if (minutes <= 1) return 'in a moment';
  if (minutes < 60) return `in ${minutes} minutes`;
  const time = new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const days = Math.floor(
    (new Date(at).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000,
  );
  if (days === 0) return `at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  return `${new Date(at).toLocaleDateString([], { weekday: 'long' })} at ${time}`;
}

/** Things to try, for someone who has not asked anything yet. */
const openers = [
  'What can you do?',
  'What’s on my calendar today?',
  'Summarize what’s on my screen.',
];

/**
 * Where the card opens. Before setup it is a short checklist, and after it the page answers
 * three questions in order: does anything need me, what is running, and what was I doing?
 */
export function HomeView({ character, agent, system, refreshKey, onOpen, onAsk }: HomeViewProps) {
  const assistant = useAssistantName();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [saved, setSaved] = useState<LibraryItem[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [connectors, setConnectors] = useState<Connector[]>([]);

  useEffect(() => {
    if (!window.edi) return;
    let alive = true;
    // Everything Home shows, read once per visit; anything that cannot be read stays empty.
    const load = <T,>(read: Promise<T[]>, set: (value: T[]) => void) =>
      void read.then(
        value => alive && set(value),
        () => alive && set([]),
      );
    load(
      // Pinned items come first; the rest are newest first.
      window.edi
        .library()
        .then(items => [
          ...items.filter(item => item.pinned),
          ...items.filter(item => !item.pinned),
        ]),
      setSaved,
    );
    load(window.edi.tasks(), setTasks);
    load(window.edi.schedules(), setSchedules);
    load(window.edi.connectors(), setConnectors);
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const prompt = draft.trim();
    if (!prompt || sending) return;
    setSending(true);
    if (await onAsk(prompt)) setDraft('');
    setSending(false);
  }

  const running = agent.status === 'running';
  const lastUser = [...agent.messages].reverse().find(message => message.role === 'user');
  const lastReply = [...agent.messages].reverse().find(message => message.role === 'assistant');
  const canTalk = system?.pushToTalk.status !== 'unavailable';
  const packs = system?.voice.packs ?? [];
  const hasVoice =
    (system?.voice.available ?? false) ||
    packs.some(pack => pack.state === 'installed' || pack.state === 'development');
  // The last step is done once the person has actually asked something.
  const steps = [
    {
      id: 'brain',
      icon: 'cpu' as const,
      title: `Give ${assistant} a brain`,
      detail: 'Add your OpenRouter key and choose a model.',
      done: agent.configured,
      open: () => onOpen('settings.ai'),
    },
    {
      id: 'voice',
      icon: 'waveform' as const,
      title: `Give ${assistant} a voice`,
      detail: 'Download the on-device voice, or use your Cartesia key.',
      done: hasVoice,
      open: () => onOpen('settings.voice'),
    },
    {
      id: 'hello',
      icon: 'chat' as const,
      title: 'Say hi',
      detail: !agent.configured
        ? 'Ready once the first step is done.'
        : canTalk
          ? 'Hold ⌥ Space and ask out loud, or type above.'
          : 'Type your first question above.',
      done: Boolean(lastUser),
      open: agent.configured ? () => setDraft(openers[0] ?? '') : undefined,
    },
  ];
  const setupLeft = steps.filter(step => !step.done);

  const attention = [
    ...(agent.approval
      ? [
          {
            id: 'approval',
            icon: 'shield' as const,
            title: `${assistant} needs your okay`,
            detail: agent.approval.preview.title,
            open: () => onOpen('conversations'),
          },
        ]
      : []),
    ...packs
      .filter(pack => pack.state === 'failed' || pack.state === 'paused')
      .map(pack => ({
        id: `pack-${pack.id}`,
        icon: 'waveform' as const,
        title: pack.state === 'failed' ? `${pack.name} didn’t download` : `${pack.name} is paused`,
        detail:
          pack.error ??
          `${Math.round(pack.received / 1_000_000)} MB of ${Math.round(pack.bytes / 1_000_000)} MB`,
        open: () => onOpen('settings.voice'),
      })),
    ...connectors
      .filter(connector => connector.status === 'needs-sign-in' || connector.status === 'needs-key')
      .map(connector => ({
        id: `connector-${connector.id}`,
        icon: 'plug' as const,
        title: `${connector.name} needs signing in again`,
        detail: 'Until then, requests that use it will stop.',
        open: () => onOpen('connectors'),
      })),
  ];

  const active = tasks.filter(task => isActiveTask(task.status));
  const next = schedules
    .flatMap(schedule => (schedule.nextRunAt ? [{ schedule, at: schedule.nextRunAt }] : []))
    .sort((a, b) => a.at - b.at)[0];

  return (
    <section className="home-view">
      <header className="home-hero">
        <span className="home-avatar">
          <CharacterArt character={character} />
        </span>
        <h1 className="ds-large-title">{greeting()}</h1>
        <p className="ds-body ds-secondary">What can I help with?</p>
      </header>

      {agent.configured && (
        <form className="home-composer ds-glass" onSubmit={submit}>
          <label htmlFor="home-draft" className="ds-visually-hidden">
            Ask {assistant}
          </label>
          <input
            id="home-draft"
            className="home-input"
            value={draft}
            maxLength={8000}
            placeholder={
              running ? `${assistant} is still answering…` : `Ask ${assistant} anything…`
            }
            disabled={running || sending}
            onChange={event => setDraft(event.target.value)}
          />
          <button
            type="submit"
            className="home-send"
            aria-label="Send"
            disabled={running || sending || !draft.trim()}
          >
            <Icon name="arrow-up" size={15} />
          </button>
        </form>
      )}

      {setupLeft.length > 0 ? (
        <GroupedList
          title="Set up"
          footer={`${steps.length - setupLeft.length} of ${steps.length} done. ${assistant} works as soon as the first one is.`}
        >
          {steps.map(step => (
            <GroupedRow
              key={step.id}
              icon={step.icon}
              title={step.title}
              detail={step.done ? undefined : step.detail}
              control={step.done ? <Icon name="check" size={16} /> : undefined}
              onOpen={step.done ? undefined : step.open}
            />
          ))}
        </GroupedList>
      ) : (
        canTalk && (
          <p className="home-hint ds-footnote ds-tertiary">
            Or hold <kbd>⌥ Space</kbd> and ask out loud.
          </p>
        )
      )}

      {attention.length > 0 && (
        <GroupedList title="Needs you">
          {attention.map(item => (
            <GroupedRow
              key={item.id}
              icon={item.icon}
              title={item.title}
              detail={item.detail}
              onOpen={item.open}
            />
          ))}
        </GroupedList>
      )}

      {(active.length > 0 || next) && (
        <GroupedList title="Happening now">
          {active.slice(0, 3).map(task => (
            <GroupedRow
              key={task.id}
              icon="clock"
              title={task.title}
              detail={task.progress || 'Working on it.'}
              onOpen={() => onOpen('tasks')}
            />
          ))}
          {next && (
            <GroupedRow
              icon="calendar"
              title={next.schedule.title}
              detail={when(next.at)}
              onOpen={() => onOpen('tasks')}
            />
          )}
        </GroupedList>
      )}

      {lastUser ? (
        <GroupedList title="Pick up where you left off">
          <GroupedRow
            icon="chat"
            title={clip(lastUser.text, 60)}
            detail={lastReply ? clip(presentationText(lastReply.text)) : undefined}
            onOpen={() => onOpen('conversations')}
          />
        </GroupedList>
      ) : (
        agent.configured && (
          <GroupedList title="Try saying">
            {openers.map(opener => (
              <GroupedRow key={opener} icon="chat" title={opener} onOpen={() => setDraft(opener)} />
            ))}
          </GroupedList>
        )
      )}

      {saved.length > 0 && (
        <GroupedList
          title={saved.some(item => item.pinned) ? 'Pinned and recent' : 'Recently saved'}
        >
          {saved.slice(0, 3).map(item => (
            <GroupedRow
              key={item.id}
              icon="notes"
              title={item.title}
              onOpen={() => onOpen('library')}
            />
          ))}
        </GroupedList>
      )}
    </section>
  );
}
