import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { presentationText, type ArtifactRef, type ConversationSummary } from '@edi/contracts';
import { ReplyText } from '../../components/ReplyText';
import { Button, EmptyState, Icon, IconButton, ThinkingDots } from '../../components/ui';
import { ConversationList } from './ConversationList';
import type { Command } from '../../lib/bridge';
import { useAgentState } from '../../hooks/useAgentState';
import { ActionTrail } from '../../components/ActionTrail';
import { ArtifactCard } from '../../components/artifacts/Artifact';
import './conversation.css';
import { useAssistantName } from '../../hooks/useAssistantName';

/** The current conversation. AI setup lives in Settings → AI. */
export function AgentPanel({
  onSetUp,
  onOpenArtifact,
}: {
  onSetUp(): void;
  onOpenArtifact(ref: ArtifactRef): void;
}) {
  const assistant = useAssistantName();
  const { state, loading, error: loadError } = useAgentState();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [commandError, setError] = useState('');
  const threadRef = useRef<HTMLDivElement>(null);
  const pin = useRef(true);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const error = commandError || loadError;
  const running = state.status === 'running';
  const [browsing, setBrowsing] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);

  // The list follows new questions, finished turns and switches.
  useEffect(() => {
    let alive = true;
    void window.edi
      ?.conversations()
      .then(list => alive && setConversations(list))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [browsing, state.conversationId, state.status]);

  useEffect(() => {
    if (running) pin.current = true;
  }, [running, state.runId]);

  useEffect(() => {
    const el = threadRef.current;
    if (el && pin.current) el.scrollTop = el.scrollHeight;
  }, [state.messages, state.text, state.status, state.steps]);

  async function command(value: Command) {
    if (!window.edi) return false;
    setBusy(true);
    setError('');
    try {
      await window.edi.command(value);
      return true;
    } catch {
      setError('Could not complete that request. Check your setup and try again.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    const prompt = draft.trim();
    if (!prompt || running || busy) return;
    setDraft('');
    pin.current = true;
    grow(null);
    if (!(await command({ type: 'ask-agent', prompt }))) setDraft(prompt);
  }

  function onThreadScroll() {
    const el = threadRef.current;
    if (!el) return;
    pin.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }

  function grow(node: HTMLTextAreaElement | null) {
    const el = node ?? areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }

  function onComposerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  if (loading)
    return (
      <p role="status" className="ds-callout ds-secondary">
        Loading your connection…
      </p>
    );

  if (!state.configured) {
    return (
      <section className="agent-panel" data-setup>
        <EmptyState icon="chat" title="Connect an AI model first.">
          <p className="ds-body ds-secondary">
            Add your OpenRouter key in Settings, then come back to talk with {assistant}.
          </p>
          <Button variant="prominent" trailingIcon="chevron-right" onClick={onSetUp}>
            Set up AI
          </Button>
        </EmptyState>
      </section>
    );
  }

  const title =
    conversations?.find(entry => entry.id === state.conversationId)?.title ??
    (state.messages[0]?.role === 'user' ? state.messages[0].text : '') ??
    '';

  async function switchTo(value: Command) {
    if (await command(value)) {
      setBrowsing(false);
      pin.current = true;
      areaRef.current?.focus();
    }
  }

  const toolbar = (
    <div className="conversation-bar">
      {browsing ? (
        <IconButton icon="back" label="Back to conversation" onClick={() => setBrowsing(false)} />
      ) : (
        <IconButton icon="clock" label="All conversations" onClick={() => setBrowsing(true)} />
      )}
      <span className="conversation-bar-title" title={title || undefined}>
        {browsing ? 'All conversations' : title || 'New conversation'}
      </span>
      {!browsing && (
        <IconButton
          icon="compose"
          label="New conversation"
          disabled={running || busy || state.messages.length === 0}
          onClick={() => void switchTo({ type: 'new-conversation' })}
        />
      )}
    </div>
  );

  if (browsing)
    return (
      <section className="agent-panel" data-ready>
        {toolbar}
        {error && (
          <p role="alert" className="agent-error agent-error-dock">
            {error}
          </p>
        )}
        <ConversationList
          conversations={conversations}
          currentId={state.conversationId}
          running={running}
          onOpen={id =>
            id === state.conversationId
              ? setBrowsing(false)
              : void switchTo({ type: 'open-conversation', id })
          }
          onNew={() => void switchTo({ type: 'new-conversation' })}
          onDelete={id =>
            void command({ type: 'delete-conversation', id }).then(() =>
              window.edi
                ?.conversations()
                .then(setConversations)
                .catch(() => {}),
            )
          }
        />
      </section>
    );

  const lastAssistant = [...state.messages].reverse().find(message => message.role === 'assistant');
  const lastUser = [...state.messages].reverse().find(message => message.role === 'user');
  // Steps and a failure belong to the latest turn; its error already reads as Edi's reply.
  const liveAssistantId = state.runId || running ? lastAssistant?.id : undefined;
  const retryPrompt = state.prompt || lastUser?.text || '';
  const failedId =
    state.status === 'error' && retryPrompt && lastAssistant?.text === state.error
      ? lastAssistant.id
      : undefined;
  const streamingId = running ? lastAssistant?.id : undefined;

  return (
    <section className="agent-panel" data-ready>
      {toolbar}
      <div
        ref={threadRef}
        className="agent-thread"
        role="log"
        aria-busy={running}
        onScroll={onThreadScroll}
      >
        {state.messages.length === 0 && (
          <div className="agent-empty">
            <h1 className="ds-title">What’s on your mind?</h1>
            <p className="ds-footnote ds-secondary">
              Type below, or hold <kbd>⌥ Space</kbd> and ask out loud.
            </p>
          </div>
        )}
        {state.messages.map(message => {
          if (message.role === 'note')
            return (
              <p key={message.id} className="agent-note" role="note">
                {message.text}
              </p>
            );
          const pending = message.id === streamingId;
          const body = message.role === 'assistant' ? presentationText(message.text) : message.text;
          return (
            <article
              key={message.id}
              className="agent-turn"
              data-role={message.role}
              data-pending={pending || undefined}
            >
              {(body || pending || !message.artifacts?.length) && (
                <div className="agent-bubble">
                  {message.role === 'assistant' && pending && !body ? (
                    <ThinkingDots />
                  ) : (
                    <p className="agent-bubble-text">
                      {message.role === 'assistant' ? <ReplyText text={body} /> : body}
                      {pending && body ? <span className="agent-caret" aria-hidden="true" /> : null}
                    </p>
                  )}
                </div>
              )}
              {message.artifacts?.map(artifact => (
                <ArtifactCard
                  key={artifact.id}
                  artifact={artifact}
                  onOpen={() =>
                    onOpenArtifact(
                      artifact.noteId && !pending
                        ? { noteId: artifact.noteId }
                        : { callId: artifact.id },
                    )
                  }
                />
              ))}
              {message.id === liveAssistantId ? (
                <ActionTrail steps={state.steps} working={running} />
              ) : (
                message.steps && <ActionTrail steps={message.steps} working={false} />
              )}
              {message.id === failedId && (
                <Button
                  size="small"
                  className="agent-retry"
                  disabled={busy || running}
                  onClick={() => void command({ type: 'ask-agent', prompt: retryPrompt })}
                >
                  Try again
                </Button>
              )}
            </article>
          );
        })}
        {state.error && !running && !failedId && (
          <p role="alert" className="agent-error">
            {state.error}
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="agent-error agent-error-dock">
          {error}
        </p>
      )}
      {state.screenAccess && state.screenAccess !== 'granted' && (
        <div role="note" className="agent-notice">
          <p>
            {state.screenAccess === 'restricted'
              ? 'Screen Recording is restricted on this Mac.'
              : `${assistant} can’t see your screen yet. Turn on Screen Recording, then ask again.`}
          </p>
          {state.screenAccess !== 'restricted' && (
            <Button
              variant="plain"
              size="small"
              disabled={busy || running}
              onClick={() =>
                void window.edi?.command({
                  type:
                    state.screenAccess === 'denied'
                      ? 'permission-open-settings'
                      : 'permission-request',
                  permission: 'screen-recording',
                })
              }
            >
              {state.screenAccess === 'denied'
                ? 'Open Screen Recording Settings'
                : 'Allow Screen Recording'}
            </Button>
          )}
        </div>
      )}

      <form
        className="agent-composer ds-glass"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void send();
        }}
      >
        <label htmlFor="agent-draft" className="ds-visually-hidden">
          Message {assistant}
        </label>
        <textarea
          ref={el => {
            areaRef.current = el;
            if (el) grow(el);
          }}
          id="agent-draft"
          className="ds-input"
          rows={1}
          value={draft}
          maxLength={8000}
          placeholder={`Ask ${assistant}…`}
          disabled={busy && !running}
          onChange={event => {
            setDraft(event.target.value);
            grow(event.target);
          }}
          onKeyDown={onComposerKey}
        />
        {running ? (
          <button
            type="button"
            className="agent-send"
            data-stop
            disabled={busy}
            aria-label="Stop response"
            onClick={() => void command({ type: 'stop-agent' })}
          >
            <Icon name="stop" size={14} />
          </button>
        ) : (
          <button
            type="submit"
            className="agent-send"
            disabled={busy || !draft.trim()}
            aria-label="Send"
          >
            <Icon name="arrow-up" size={15} />
          </button>
        )}
      </form>
      <p className="agent-composer-meta">
        <span className="ds-caption ds-tertiary">{state.model}</span>
        <Button variant="plain" size="small" onClick={onSetUp}>
          AI settings
        </Button>
      </p>
    </section>
  );
}
