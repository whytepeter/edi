import { useState } from 'react';
import { Button, TextField } from '../../components/ui';
import type { Command } from '../../lib/bridge';
import { useAgentState } from '../../hooks/useAgentState';
import { StepList } from '../../components/StepList';
import './conversation.css';

/** Temporary OpenRouter connection test. Not the final conversation surface. */
export function AgentPanel() {
  const { state, loading, error: loadError } = useAgentState();
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [commandError, setError] = useState('');
  const error = commandError || loadError;
  async function command(value: Command) {
    if (!window.edi) return;
    setBusy(true);
    setError('');
    try {
      await window.edi.command(value);
    } catch {
      setError('Could not complete that request. Check your setup and try again.');
    } finally {
      setBusy(false);
      setApiKey('');
    }
  }
  if (loading)
    return (
      <p role="status" className="ds-callout ds-secondary">
        Loading your connection…
      </p>
    );
  const running = state.status === 'running';
  const status =
    state.status === 'running'
      ? 'Edi is responding…'
      : state.status === 'stopped'
        ? 'Stopped. Usage already processed may still be billed.'
        : state.status === 'done'
          ? 'Response complete'
          : '';
  return (
    <section className="agent-panel">
      <header className="view-header">
        <p className="ds-eyebrow">OpenRouter</p>
        <h1 className="ds-large-title">
          {state.configured ? 'What’s on your mind?' : 'Connect Edi.'}
        </h1>
        {!state.configured && (
          <p className="ds-body ds-secondary">
            Use your OpenRouter key and the exact model ID you want to use.
          </p>
        )}
        {state.configured && <p className="agent-model ds-footnote ds-tertiary">{state.model}</p>}
      </header>
      {error && (
        <p role="alert" className="agent-error">
          {error}
        </p>
      )}
      {!state.configured ? (
        <form
          className="agent-form"
          onSubmit={event => {
            event.preventDefault();
            void command({ type: 'configure-agent', apiKey, model });
          }}
        >
          <TextField
            label="API key"
            aria-label="OpenRouter API key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            onChange={event => setApiKey(event.target.value)}
            required
            minLength={10}
            maxLength={512}
          />
          <TextField
            label="Model ID"
            aria-label="OpenRouter model ID"
            placeholder="provider/model-name"
            value={model}
            onChange={event => setModel(event.target.value)}
            required
            maxLength={160}
            pattern="[a-zA-Z0-9_.:/\-]+"
          />
          <p className="ds-footnote ds-tertiary">
            Stored encrypted on this Mac. Saving does not validate your key or make a paid request.
          </p>
          <Button type="submit" variant="prominent" block disabled={busy}>
            Save connection
          </Button>
        </form>
      ) : (
        <>
          <form
            className="agent-form"
            onSubmit={event => {
              event.preventDefault();
              void command({ type: 'ask-agent', prompt });
            }}
          >
            <TextField
              multiline
              label="Your message"
              aria-label="Message Edi"
              value={prompt}
              onChange={event => setPrompt(event.target.value)}
              required
              maxLength={8000}
              rows={3}
              placeholder="Ask Edi something…"
            />
            <p className="ds-footnote ds-tertiary">
              Each message goes to OpenRouter with a screenshot of every screen, taken as you send.
              Screenshots are never saved. Edi asks before saving anything.
            </p>
            {running ? (
              <Button
                variant="prominent"
                block
                disabled={busy}
                onClick={() => void command({ type: 'stop-agent' })}
              >
                Stop response
              </Button>
            ) : (
              <Button type="submit" variant="prominent" block disabled={busy || !prompt.trim()}>
                Send to Edi
              </Button>
            )}
          </form>
          <div role="status" className="agent-status ds-footnote ds-secondary">
            {status}
          </div>
          {(state.screenAccess === 'denied' || state.screenAccess === 'restricted') && (
            <p role="note" className="agent-notice">
              Edi can’t see your screen. To let it, open System Settings → Privacy &amp; Security →
              Screen &amp; System Audio Recording and turn on Edi, then ask again.
            </p>
          )}
          <StepList steps={state.steps} label="What Edi did" />
          {state.error && (
            <p role="alert" className="agent-error">
              {state.error}
            </p>
          )}
          {state.text && (
            <article aria-label="Edi response" className="agent-response">
              {state.text}
            </article>
          )}
          <Button
            variant="plain"
            size="small"
            disabled={busy || running}
            onClick={() => void command({ type: 'disconnect-agent' })}
          >
            Remove saved key / change model
          </Button>
        </>
      )}
    </section>
  );
}
