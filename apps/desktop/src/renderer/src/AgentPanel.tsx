import { useEffect, useState } from 'react';
import type { AgentState } from '@edi/contracts';

export function AgentPanel() {
  const [state, setState] = useState<AgentState>({
    configured: false,
    model: '',
    status: 'idle',
    text: '',
    error: '',
  });
  const [loading, setLoading] = useState(true);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const unsubscribe = window.edi?.onAgent(value => {
      if (alive) setState(value);
    });
    window.edi
      ?.agent()
      .then(value => {
        if (alive) {
          setState(value);
          setLoading(false);
        }
      })
      .catch(() => {
        if (alive) {
          setLoading(false);
          setError('Could not load the connection.');
        }
      });
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, []);
  async function command(value: Parameters<NonNullable<typeof window.edi>['command']>[0]) {
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
  if (loading) return <p role="status">Loading your connection…</p>;
  return (
    <section className="agent-panel">
      <div className="eyebrow">OPENROUTER</div>
      <h1>{state.configured ? 'What’s on your mind?' : 'Connect Edi.'}</h1>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!state.configured ? (
        <form
          onSubmit={event => {
            event.preventDefault();
            void command({ type: 'configure-agent', apiKey, model });
          }}
        >
          <p>Use your OpenRouter key and the exact model ID you want to use.</p>
          <label>
            API key
            <input
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
          </label>
          <label>
            Model ID
            <input
              aria-label="OpenRouter model ID"
              placeholder="provider/model-name"
              value={model}
              onChange={event => setModel(event.target.value)}
              required
              maxLength={160}
              pattern="[a-zA-Z0-9_.:/\-]+"
            />
          </label>
          <p className="fine-print">
            Stored encrypted on this Mac. Saving does not validate your key or make a paid request.
          </p>
          <button className="primary-button" disabled={busy}>
            Save connection
          </button>
        </form>
      ) : (
        <>
          <p className="model-label">{state.model}</p>
          <form
            onSubmit={event => {
              event.preventDefault();
              void command({ type: 'ask-agent', prompt });
            }}
          >
            <label>
              Your message
              <textarea
                aria-label="Message Edi"
                value={prompt}
                onChange={event => setPrompt(event.target.value)}
                required
                maxLength={8000}
                rows={3}
                placeholder="Ask Edi something…"
              />
            </label>
            <p className="fine-print">
              Sends this message to OpenRouter and its model provider. Your OpenRouter rates apply.
              Each request starts fresh; no screen or files are sent.
            </p>
            {state.status === 'running' ? (
              <button
                type="button"
                className="primary-button"
                disabled={busy}
                onClick={() => void command({ type: 'stop-agent' })}
              >
                Stop response
              </button>
            ) : (
              <button className="primary-button" disabled={busy || !prompt.trim()}>
                Send to Edi
              </button>
            )}
          </form>
          <div role="status" className="agent-status">
            {state.status === 'running'
              ? 'Edi is responding…'
              : state.status === 'stopped'
                ? 'Stopped. Usage already processed may still be billed.'
                : state.status === 'done'
                  ? 'Response complete'
                  : ''}
          </div>
          {state.error && (
            <p role="alert" className="error">
              {state.error}
            </p>
          )}
          {state.text && (
            <article aria-label="Edi response" className="agent-response">
              {state.text}
            </article>
          )}
          <button
            className="text-button"
            disabled={busy || state.status === 'running'}
            onClick={() => void command({ type: 'disconnect-agent' })}
          >
            Remove saved key / change model
          </button>
        </>
      )}
    </section>
  );
}
