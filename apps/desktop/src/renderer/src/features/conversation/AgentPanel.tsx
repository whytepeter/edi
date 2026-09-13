import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { presentationText, type ArtifactRef } from '@edi/contracts';
import { ReplyText } from './ReplyText';
import { Button, EmptyState, Icon, ThinkingDots } from '../../components/ui';
import type { Command } from '../../lib/bridge';
import { useAgentState } from '../../hooks/useAgentState';
import { StepList } from '../../components/StepList';
import { ArtifactCard } from '../../components/artifacts/Artifact';
import './conversation.css';

/** The current conversation. AI setup lives in Settings → AI. */
export function AgentPanel({
  onSetUp,
  onOpenArtifact,
}: {
  onSetUp(): void;
  onOpenArtifact(ref: ArtifactRef): void;
}) {
  const { state, loading, error: loadError } = useAgentState();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [commandError, setError] = useState('');
  const threadRef = useRef<HTMLDivElement>(null);
  const pin = useRef(true);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const error = commandError || loadError;
  const running = state.status === 'running';

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
            Add your OpenRouter key in Settings, then come back to talk with Edi.
          </p>
          <Button variant="prominent" trailingIcon="chevron-right" onClick={onSetUp}>
            Set up AI
          </Button>
        </EmptyState>
      </section>
    );
  }

  const lastAssistant = [...state.messages].reverse().find(message => message.role === 'assistant');
  const streamingId = running ? lastAssistant?.id : undefined;

  return (
    <section className="agent-panel" data-ready>
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
              {pending && <StepList steps={state.steps} label="What Edi did" />}
            </article>
          );
        })}
        {state.error && !running && (
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
              : 'Edi can’t see your screen yet. Turn on Screen Recording, then ask again.'}
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
          Message Edi
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
          placeholder="Ask Edi…"
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
