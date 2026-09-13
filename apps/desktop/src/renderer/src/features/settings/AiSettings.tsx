import { useState } from 'react';
import type { Command } from '@edi/contracts';
import { Button, GroupedList, GroupedRow, TextField } from '../../components/ui';
import { useAgentState } from '../../hooks/useAgentState';
import { ModelPicker } from './ModelPicker';
import './settings.css';

/**
 * Settings → AI: the OpenRouter key and the model Edi uses. The saved key never comes
 * back to this window, so the page shows that one is saved instead of an empty field.
 */
export function AiSettings() {
  const { state, loading } = useAgentState();
  const [replacingKey, setReplacingKey] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [apiKey, setApiKey] = useState('');
  // Before a connection exists, the chosen model waits here to be saved with the key.
  const [pendingModel, setPendingModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function command(value: Command, done: string) {
    if (!window.edi) return false;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await window.edi.command(value);
      setNotice(done);
      return true;
    } catch {
      setError('Couldn’t save that. Check the key and try again.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (loading)
    return (
      <p role="status" className="ds-callout ds-secondary">
        Loading your connection…
      </p>
    );

  const keyValid = apiKey.trim().length >= 10;
  const model = state.configured ? state.model : pendingModel;

  const keyField = (
    <TextField
      label={state.configured ? 'New API key' : 'API key'}
      aria-label="OpenRouter API key"
      type="password"
      autoComplete="off"
      spellCheck={false}
      placeholder="sk-or-…"
      value={apiKey}
      onChange={event => setApiKey(event.target.value)}
      maxLength={512}
    />
  );

  return (
    <div className="settings-page">
      {!state.configured && (
        <header className="view-header">
          <h1 className="ds-large-title">Connect Edi to a model.</h1>
          <p className="ds-body ds-secondary">
            Edi uses your own OpenRouter key. Add it, pick a model, and you’re set.
          </p>
        </header>
      )}
      {error && (
        <p role="alert" className="workspace-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="ds-footnote ds-secondary">
          {notice}
        </p>
      )}

      {state.configured && !replacingKey ? (
        <GroupedList
          title="OpenRouter key"
          footer="Stored encrypted on this Mac and only sent to OpenRouter. Edi never shows it again after saving."
        >
          <GroupedRow
            icon="shield"
            title="Key saved"
            detail="Saved securely on this Mac"
            control={
              <Button size="small" onClick={() => setReplacingKey(true)}>
                Replace
              </Button>
            }
          />
        </GroupedList>
      ) : (
        <div className="settings-form">
          {keyField}
          <p className="ds-footnote ds-tertiary">
            Stored encrypted on this Mac and only sent to OpenRouter. Edi never shows it again after
            saving.
          </p>
          {replacingKey && (
            <div className="settings-actions">
              <Button
                variant="prominent"
                disabled={busy || !keyValid}
                onClick={() =>
                  void command(
                    { type: 'configure-agent', apiKey: apiKey.trim(), model: state.model },
                    'New key saved.',
                  ).then(ok => {
                    if (!ok) return;
                    setApiKey('');
                    setReplacingKey(false);
                  })
                }
              >
                Save key
              </Button>
              <Button
                variant="plain"
                onClick={() => {
                  setApiKey('');
                  setReplacingKey(false);
                }}
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
      )}

      <ModelPicker
        value={model}
        saved={state.configured}
        disabled={busy}
        onChange={id => {
          if (!state.configured) return setPendingModel(id);
          if (id !== state.model)
            void command({ type: 'configure-agent', model: id }, 'Model saved.');
        }}
      />

      {!state.configured && (
        <div className="settings-actions">
          <Button
            variant="prominent"
            disabled={busy || !keyValid || !pendingModel}
            onClick={() =>
              void command(
                { type: 'configure-agent', apiKey: apiKey.trim(), model: pendingModel },
                'Connected. Saving doesn’t check the key or make a paid request.',
              ).then(ok => ok && setApiKey(''))
            }
          >
            Save connection
          </Button>
        </div>
      )}

      {state.configured && (
        <div className="settings-actions">
          {confirmDisconnect ? (
            <>
              <Button
                variant="plain"
                disabled={busy}
                onClick={() =>
                  void command({ type: 'disconnect-agent' }, 'Key removed from this Mac.').then(
                    () => setConfirmDisconnect(false),
                  )
                }
              >
                Remove key from this Mac
              </Button>
              <Button variant="plain" onClick={() => setConfirmDisconnect(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="plain" onClick={() => setConfirmDisconnect(true)}>
              Disconnect
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
