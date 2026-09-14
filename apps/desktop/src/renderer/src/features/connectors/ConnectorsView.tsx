import { useEffect, useState, type FormEvent } from 'react';
import {
  connectorCatalog,
  connectorUrlSchema,
  type Command,
  type Connector,
  type ConnectorStatus,
} from '@edi/contracts';
import { Button, GroupedList, GroupedRow, Switch, TextField } from '../../components/ui';
import './connectors.css';

const statusText: Record<ConnectorStatus, string> = {
  connected: 'Connected',
  connecting: 'Connecting…',
  'needs-sign-in': 'Needs you to sign in',
  'signing-in': 'Finish signing in in your browser',
  error: 'Couldn’t connect',
  off: 'Off',
};

function useConnectors() {
  const [connectors, setConnectors] = useState<Connector[] | null>(null);
  useEffect(() => {
    if (!window.edi) return;
    let alive = true;
    void window.edi
      .connectors()
      .then(list => alive && setConnectors(list))
      .catch(() => alive && setConnectors([]));
    const unsubscribe = window.edi.onConnectors(list => alive && setConnectors(list));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  return connectors;
}

/** Connected apps and MCP servers: sign in, choose which tools Edi may use, remove. */
export function ConnectorsView() {
  const connectors = useConnectors();
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [address, setAddress] = useState('');
  const [name, setName] = useState('');

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

  async function addByAddress(event: FormEvent) {
    event.preventDefault();
    const url = connectorUrlSchema.safeParse(address);
    if (!url.success) {
      setError('Use the server’s full https address, e.g. https://example.com/mcp.');
      return;
    }
    const added = await send(
      { type: 'add-connector', url: url.data, ...(name.trim() ? { name: name.trim() } : {}) },
      'Couldn’t add that server.',
    );
    if (added) {
      setAddress('');
      setName('');
    }
  }

  const byCatalog = new Map(connectors?.map(connector => [connector.catalogId, connector]));
  const available = connectorCatalog.filter(entry => !byCatalog.has(entry.id));

  return (
    <section className="connectors-page">
      {error && (
        <p role="alert" className="workspace-error">
          {error}
        </p>
      )}

      {connectors && connectors.length > 0 && (
        <GroupedList
          title="Connected"
          footer="Edi asks before using any of these tools, and treats what they return as information, never instructions. Sign-ins are kept encrypted on this Mac."
        >
          {connectors.map(connector => {
            const enabledTools = connector.tools.filter(tool => tool.enabled).length;
            const signIn =
              connector.status === 'needs-sign-in' || connector.status === 'error'
                ? connector.status === 'error'
                  ? 'Try Again'
                  : 'Sign In'
                : null;
            return (
              <li key={connector.id} className="connector-item">
                <div className="ds-group-row">
                  <span className="ds-group-row-text">
                    <span className="ds-group-row-title">{connector.name}</span>
                    <span className="ds-group-row-detail">
                      {connector.status === 'connected'
                        ? `Connected · ${enabledTools} of ${connector.tools.length} tools on`
                        : connector.error || statusText[connector.status]}
                    </span>
                  </span>
                  {signIn && (
                    <Button
                      size="small"
                      variant="prominent"
                      onClick={() =>
                        void send(
                          { type: 'connect-connector', id: connector.id },
                          'Couldn’t start signing in.',
                        )
                      }
                    >
                      {signIn}
                    </Button>
                  )}
                  <Switch
                    label={`Use ${connector.name}`}
                    checked={connector.enabled}
                    onChange={enabled =>
                      void send(
                        { type: 'set-connector-enabled', id: connector.id, enabled },
                        'Couldn’t change that.',
                      )
                    }
                  />
                </div>
                <div className="connector-actions">
                  {connector.tools.length > 0 && (
                    <button
                      type="button"
                      className="connector-link"
                      aria-expanded={open === connector.id}
                      onClick={() => setOpen(open === connector.id ? null : connector.id)}
                    >
                      {open === connector.id ? 'Hide tools' : 'Choose tools'}
                    </button>
                  )}
                  {connector.status === 'connected' && (
                    <button
                      type="button"
                      className="connector-link"
                      onClick={() =>
                        void send(
                          { type: 'connect-connector', id: connector.id },
                          'Couldn’t reconnect.',
                        )
                      }
                    >
                      Reconnect
                    </button>
                  )}
                  {confirming === connector.id ? (
                    <span className="connector-confirm">
                      Remove {connector.name} and forget its sign-in?
                      <Button
                        size="small"
                        className="connector-remove"
                        onClick={() =>
                          void send(
                            { type: 'remove-connector', id: connector.id },
                            'Couldn’t remove it.',
                          ).then(() => setConfirming(null))
                        }
                      >
                        Remove
                      </Button>
                      <Button size="small" onClick={() => setConfirming(null)}>
                        Cancel
                      </Button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="connector-link"
                      onClick={() => setConfirming(connector.id)}
                    >
                      Remove
                    </button>
                  )}
                </div>
                {open === connector.id && (
                  <ul className="connector-tools" aria-label={`${connector.name} tools`}>
                    {connector.tools.map(tool => (
                      <li key={tool.name} className="connector-tool">
                        <span className="ds-group-row-text">
                          <span className="ds-group-row-title">
                            {tool.title}
                            {tool.readOnly && <span className="connector-badge">Reads</span>}
                          </span>
                          {tool.description && (
                            <span className="ds-group-row-detail">{tool.description}</span>
                          )}
                        </span>
                        <Switch
                          label={`Let Edi use ${tool.title}`}
                          checked={tool.enabled}
                          onChange={enabled =>
                            void send(
                              {
                                type: 'set-connector-tool',
                                id: connector.id,
                                tool: tool.name,
                                enabled,
                              },
                              'Couldn’t change that tool.',
                            )
                          }
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </GroupedList>
      )}

      {available.length > 0 && (
        <GroupedList
          title="Apps"
          footer="Connecting opens the app’s sign-in page in your browser. Edi uses your own account."
        >
          {available.map(entry => (
            <GroupedRow
              key={entry.id}
              icon="plug"
              title={entry.name}
              detail={entry.description}
              control={
                <Button
                  size="small"
                  onClick={() =>
                    void send(
                      { type: 'add-connector', catalogId: entry.id },
                      `Couldn’t connect ${entry.name}.`,
                    )
                  }
                >
                  Connect
                </Button>
              }
            />
          ))}
        </GroupedList>
      )}

      <GroupedList
        title="Add an MCP server"
        footer="Only add servers you trust. Anyone can run one, and Edi can’t check what it does; it still asks before using any of its tools."
      >
        <li>
          <form className="connector-form" onSubmit={event => void addByAddress(event)}>
            <TextField
              label="Server address"
              placeholder="https://example.com/mcp"
              value={address}
              onChange={event => setAddress(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <TextField
              label="Name (optional)"
              placeholder="Shown in Edi"
              value={name}
              maxLength={60}
              onChange={event => setName(event.target.value)}
            />
            <div>
              <Button type="submit" size="small" disabled={!address.trim()}>
                Add Server
              </Button>
            </div>
          </form>
        </li>
      </GroupedList>
    </section>
  );
}
