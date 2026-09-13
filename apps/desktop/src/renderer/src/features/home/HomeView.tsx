import { useEffect, useState, type FormEvent } from 'react';
import {
  presentationText,
  type AgentState,
  type LibraryItem,
  type SkinId,
  type SystemInfo,
  type WorkspaceView,
} from '@edi/contracts';
import { GroupedList, GroupedRow, Icon } from '../../components/ui';
import { Pet } from '../../components/Pet';
import './home.css';

interface HomeViewProps {
  skin: SkinId;
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

/** Where the card opens: ask something, pick up where you left off, or finish setup. */
export function HomeView({ skin, agent, system, refreshKey, onOpen, onAsk }: HomeViewProps) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [saved, setSaved] = useState<LibraryItem[]>([]);

  useEffect(() => {
    if (!window.edi) return;
    let alive = true;
    window.edi
      .library()
      .then(items => alive && setSaved(items.slice(0, 3)))
      .catch(() => alive && setSaved([]));
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

  return (
    <section className="home-view">
      <header className="home-hero">
        <span className="home-avatar">
          <Pet skin={skin} />
        </span>
        <h1 className="ds-large-title">{greeting()}</h1>
        <p className="ds-body ds-secondary">What can I help with?</p>
      </header>

      {agent.configured ? (
        <form className="home-composer ds-glass" onSubmit={submit}>
          <label htmlFor="home-draft" className="ds-visually-hidden">
            Ask Edi
          </label>
          <input
            id="home-draft"
            className="home-input"
            value={draft}
            maxLength={8000}
            placeholder={running ? 'Edi is still answering…' : 'Ask Edi anything…'}
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
      ) : (
        <GroupedList title="Get started">
          <GroupedRow
            icon="cpu"
            title="Set up AI"
            detail="Add your OpenRouter key and choose a model."
            onOpen={() => onOpen('settings.ai')}
          />
        </GroupedList>
      )}

      {canTalk && (
        <p className="home-hint ds-footnote ds-tertiary">
          Or hold <kbd>⌥ Space</kbd> and ask out loud.
        </p>
      )}

      {lastUser && (
        <GroupedList title="Pick up where you left off">
          <GroupedRow
            icon="chat"
            title={clip(lastUser.text, 60)}
            detail={lastReply ? clip(presentationText(lastReply.text)) : undefined}
            onOpen={() => onOpen('conversations')}
          />
        </GroupedList>
      )}

      {saved.length > 0 && (
        <GroupedList title="Recently saved">
          {saved.map(item => (
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
