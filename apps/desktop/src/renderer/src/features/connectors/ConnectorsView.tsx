import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  connectorCatalog,
  connectorUrlSchema,
  describeLocalServer,
  localServerSchema,
  type Command,
  type Connector,
  type ConnectorStatus,
  type ConnectorTool,
  type LocalServer,
  type LocalServerRuntime,
} from '@edi/contracts';
import { Button, GroupedList, GroupedRow, Icon, Switch, TextField } from '../../components/ui';
import { BrandIcon } from '../../components/BrandIcon';
import { commandMessage } from '../../lib/command-message';
import './connectors.css';

const statusText: Record<ConnectorStatus, string> = {
  connected: 'Connected',
  connecting: 'Connecting…',
  'needs-sign-in': 'Needs sign-in',
  'needs-key': 'Needs your Composio key',
  'signing-in': 'Signing in…',
  error: 'Connection failed',
  off: 'Off',
};

const statusDot: Partial<Record<ConnectorStatus, string>> = {
  connected: 'connector-dot-ok',
  connecting: 'connector-dot-busy',
  'signing-in': 'connector-dot-busy',
  'needs-sign-in': 'connector-dot-warn',
  'needs-key': 'connector-dot-warn',
  error: 'connector-dot-error',
};

const categoryLabel: Record<string, string> = {
  communication: 'Communication',
  productivity: 'Productivity',
  files: 'Files & Storage',
  development: 'Development',
  design: 'Design',
  data: 'Data & Spreadsheets',
  marketing: 'Marketing & Social',
};

const categoryOrder = Object.keys(categoryLabel);

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

/** Composio apps are listed only once the person has saved a Composio key. */
function useComposioConfigured() {
  const [configured, setConfigured] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!window.edi) return;
    let alive = true;
    void window.edi
      .composioConfigured()
      .then(value => alive && setConfigured(value))
      .catch(() => alive && setConfigured(false));
    return () => {
      alive = false;
    };
  }, [version]);
  return [configured, () => setVersion(v => v + 1)] as const;
}

const composioAppCount = connectorCatalog.filter(entry => entry.provider === 'composio').length;

/** The person's own Composio key, which lists Gmail, Slack and the other Composio apps. */
function ComposioKey({
  configured,
  focusRequest,
  onChange,
}: {
  configured: boolean;
  /** Bumped by an app's "Replace Key": opens the key field and brings it into view. */
  focusRequest: number;
  onChange: () => void;
}) {
  const [apiKey, setApiKey] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const section = useRef<HTMLDivElement>(null);
  const footer =
    'Gmail, Slack, Google Drive and more connect through Composio. Use your Composio project’s ' +
    'API key; it is stored encrypted on this Mac, and the apps’ sign-ins are kept by Composio.';

  const [seenRequest, setSeenRequest] = useState(focusRequest);
  if (focusRequest !== seenRequest) {
    setSeenRequest(focusRequest);
    setEditing(true);
  }
  useEffect(() => {
    if (focusRequest) section.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusRequest]);

  async function run(command: Command, fallback: string) {
    setBusy(true);
    setError('');
    try {
      await window.edi?.command(command);
      return true;
    } catch (failure) {
      setError(commandMessage(failure, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (
      !(await run(
        { type: 'setup-composio', apiKey: apiKey.trim() },
        'Couldn’t save the Composio key.',
      ))
    )
      return;
    setApiKey('');
    setEditing(false);
    onChange();
  }

  async function remove() {
    if (await run({ type: 'setup-composio' }, 'Couldn’t remove the Composio key.')) onChange();
  }

  if (configured && !editing) {
    return (
      <div ref={section}>
        <GroupedList title="More apps" footer={footer}>
          <GroupedRow
            icon="shield"
            title="Composio key saved"
            detail={`${composioAppCount} more apps are listed above`}
            control={
              <span className="connector-row-actions">
                <Button size="small" disabled={busy} onClick={() => setEditing(true)}>
                  Replace
                </Button>
                <Button size="small" disabled={busy} onClick={() => void remove()}>
                  Remove
                </Button>
              </span>
            }
          />
        </GroupedList>
        {error && <p className="connector-inline-error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="connector-composio" ref={section}>
      <h2 className="ds-group-title">More apps</h2>
      <form className="connector-form" onSubmit={event => void save(event)}>
        <TextField
          label={configured ? 'New Composio API key' : 'Composio API key'}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="ak_…"
          value={apiKey}
          maxLength={512}
          autoFocus={editing}
          onChange={event => {
            setApiKey(event.target.value);
            setError('');
          }}
        />
        {error && <p className="connector-inline-error">{error}</p>}
        <p className="ds-footnote ds-tertiary">{footer}</p>
        <div className="connector-form-actions">
          <Button
            type="submit"
            size="small"
            variant="prominent"
            disabled={busy || apiKey.trim().length < 10}
          >
            {busy ? 'Checking…' : 'Save Key'}
          </Button>
          {editing && (
            <button
              type="button"
              className="connector-link"
              onClick={() => {
                setEditing(false);
                setError('');
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function ToolList({
  tools,
  connectorId,
  send,
}: {
  tools: ConnectorTool[];
  connectorId: string;
  send: (command: Command, failure: string) => Promise<boolean>;
}) {
  const reads = tools.filter(t => t.readOnly);
  const writes = tools.filter(t => !t.readOnly);
  const sections: [string, ConnectorTool[]][] = [];
  if (writes.length) sections.push(['Actions', writes]);
  if (reads.length) sections.push(['Read-only', reads]);

  return (
    <div
      className={`connector-tools${tools.length > 6 ? ' connector-tools-scroll' : ''}`}
      role="list"
      aria-label="Tools"
      tabIndex={tools.length > 6 ? 0 : undefined}
    >
      {sections.map(([label, items]) => (
        <div key={label} className="connector-tool-section">
          <span className="connector-tool-heading">{label}</span>
          {items.map(tool => (
            <div key={tool.name} className="connector-tool" role="listitem">
              <span className="connector-tool-info">
                <span className="connector-tool-name">{tool.title || tool.name}</span>
                {tool.description && (
                  <span className="connector-tool-desc">{tool.description}</span>
                )}
              </span>
              <Switch
                label={`Let Edi use ${tool.title || tool.name}`}
                checked={tool.enabled}
                onChange={enabled =>
                  void send(
                    { type: 'set-connector-tool', id: connectorId, tool: tool.name, enabled },
                    'Couldn’t change that tool.',
                  )
                }
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function CustomServerPopover({
  onAdd,
  onAddLocal,
  onClose,
}: {
  onAdd: (url: string, name: string) => Promise<boolean>;
  onAddLocal: (local: LocalServer, name: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [where, setWhere] = useState<'web' | 'mac'>('web');
  const [address, setAddress] = useState('');
  const [runtime, setRuntime] = useState<LocalServerRuntime>('node');
  const [pkg, setPkg] = useState('');
  const [version, setVersion] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (where === 'web') {
      const parsed = connectorUrlSchema.safeParse(address);
      if (!parsed.success) {
        setError('Use the server’s full https address.');
        return;
      }
      setError('');
      const ok = await onAdd(parsed.data, name.trim());
      if (ok) onClose();
      else setError('Couldn’t add that server.');
      return;
    }
    // The version is required and exact: what runs stays what was added.
    const parsed = localServerSchema.safeParse({
      runtime,
      package: pkg.trim(),
      version: version.trim(),
      args: [],
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the package and version.');
      return;
    }
    setError('');
    const ok = await onAddLocal(parsed.data, name.trim());
    if (ok) onClose();
    else setError('Couldn’t add that server.');
  }

  const ready = where === 'web' ? address.trim() : pkg.trim() && version.trim();

  return (
    <div className="connector-popover" ref={ref}>
      <form className="connector-form" onSubmit={event => void submit(event)}>
        <div className="connector-where" role="group" aria-label="Where the server runs">
          <button
            type="button"
            className="connector-where-choice"
            aria-pressed={where === 'web'}
            onClick={() => {
              setWhere('web');
              setError('');
            }}
          >
            On the web
          </button>
          <button
            type="button"
            className="connector-where-choice"
            aria-pressed={where === 'mac'}
            onClick={() => {
              setWhere('mac');
              setError('');
            }}
          >
            On this Mac
          </button>
        </div>

        {where === 'web' ? (
          <TextField
            label="Server address"
            placeholder="https://example.com/mcp"
            value={address}
            onChange={event => setAddress(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />
        ) : (
          <>
            <label className="connector-field">
              <span className="connector-field-label">Runtime</span>
              <select
                className="connector-select"
                value={runtime}
                onChange={event => setRuntime(event.target.value as LocalServerRuntime)}
              >
                <option value="node">Node (npx)</option>
                <option value="python">Python (uvx)</option>
              </select>
            </label>
            <TextField
              label="Package"
              placeholder={runtime === 'node' ? 'notes-server' : 'notes_server'}
              value={pkg}
              onChange={event => setPkg(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
            <TextField
              label="Version"
              placeholder="1.4.2"
              value={version}
              onChange={event => setVersion(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <p className="ds-footnote ds-tertiary">
              Runs on this Mac with your own access, pinned to that exact version. Its own install
              scripts are refused, and it never sees your keys.
            </p>
          </>
        )}

        <TextField
          label="Name (optional)"
          placeholder="Shown in Edi"
          value={name}
          maxLength={60}
          onChange={event => setName(event.target.value)}
        />
        {error && <p className="connector-popover-error">{error}</p>}
        <div className="connector-form-actions">
          <Button type="submit" size="small" disabled={!ready}>
            Add Server
          </Button>
          <button type="button" className="connector-link" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

/** What's wrong with a connection, in plain words, and the one action that fixes it. */
function problemOf(connector: Connector, composioConfigured: boolean) {
  switch (connector.status) {
    case 'needs-key':
      return {
        text:
          connector.error ||
          `Edi needs your Composio key to reach ${connector.name}. Add it under More apps.`,
        action: composioConfigured ? 'Replace Key' : 'Add Key',
        fix: 'key' as const,
      };
    case 'signing-in':
      return {
        text: `Finish signing in to ${connector.name} in your browser. This page updates by itself.`,
        action: 'Open Sign-In Again',
        fix: 'connect' as const,
      };
    case 'needs-sign-in':
      return {
        text: `Sign in to ${connector.name} so Edi can use it.`,
        action: 'Sign In',
        fix: 'connect' as const,
      };
    case 'error':
      return {
        text: connector.error || `Edi couldn’t connect to ${connector.name}.`,
        action: 'Try Again',
        fix: 'connect' as const,
      };
    default:
      return null;
  }
}

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function ConnectedApp({
  connector,
  expanded,
  onToggle,
  onReplaceKey,
  send,
  composioConfigured,
}: {
  connector: Connector;
  expanded: boolean;
  onToggle: () => void;
  onReplaceKey: () => void;
  send: (command: Command, failure: string) => Promise<boolean>;
  composioConfigured?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const enabledTools = connector.tools.filter(tool => tool.enabled).length;
  const recommended = new Set(
    connectorCatalog.find(entry => entry.id === connector.catalogId)?.tools ?? [],
  );
  const recommendedCount = connector.tools.filter(tool => recommended.has(tool.name)).length;
  const usingRecommended = connector.tools.every(
    tool => tool.enabled === recommended.has(tool.name),
  );
  const problem = connector.enabled ? problemOf(connector, composioConfigured ?? true) : null;
  const viaComposio = connector.provider === 'composio';
  const dot = statusDot[connector.status] ?? '';
  const status =
    connector.status === 'connected'
      ? `${enabledTools} of ${connector.tools.length} tools`
      : statusText[connector.status];
  const connect = () =>
    void send({ type: 'connect-connector', id: connector.id }, 'Couldn’t start signing in.');

  return (
    <li className="connector-item">
      <button
        type="button"
        className="connector-header"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <BrandIcon catalogId={connector.catalogId} name={connector.name} />
        <span className="connector-header-text">
          <span className="connector-header-title">{connector.name}</span>
          <span className="connector-header-status">
            {dot && <span className={`connector-dot ${dot}`} />}
            <span>{status}</span>
            {viaComposio && <span className="connector-via">· via Composio</span>}
          </span>
        </span>
        <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={14} />
      </button>

      {expanded && (
        <div className="connector-expanded">
          {problem && (
            <div
              className={`connector-notice${connector.status === 'error' ? ' connector-notice-error' : ''}`}
              role="status"
            >
              <Icon name="info" size={16} />
              <p>{problem.text}</p>
              <Button
                size="small"
                variant="prominent"
                onClick={problem.fix === 'key' ? onReplaceKey : connect}
              >
                {problem.action}
              </Button>
            </div>
          )}

          {/* Using an app only means something once it is connected, or to switch it back on. */}
          {(connector.status === 'connected' || !connector.enabled) && (
            <div className="connector-setting">
              <span className="connector-setting-text">
                <span>Use {connector.name}</span>
                <span className="connector-setting-detail">
                  {connector.local
                    ? `Runs on this Mac: ${describeLocalServer(connector.local)}. Pinned to that version.`
                    : viaComposio
                      ? 'Signs in through Composio, which keeps the sign-in.'
                      : `Connected directly to ${hostOf(connector.url)}; the sign-in stays on this Mac.`}
                </span>
              </span>
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
          )}

          {recommendedCount > 0 && !usingRecommended && (
            <div className="connector-tools-note">
              <span>
                {enabledTools} of {connector.tools.length} tools are on. Edi recommends{' '}
                {recommendedCount} for everyday use.
              </span>
              <button
                type="button"
                className="connector-link"
                onClick={() =>
                  void send(
                    { type: 'use-recommended-tools', id: connector.id },
                    'Couldn’t change the tools.',
                  )
                }
              >
                Use Recommended
              </button>
            </div>
          )}

          {connector.tools.length > 0 && (
            <ToolList tools={connector.tools} connectorId={connector.id} send={send} />
          )}

          <div className="connector-footer-actions">
            {confirming ? (
              <span className="connector-confirm">
                Remove {connector.name} and forget its sign-in?
                <Button
                  size="small"
                  className="connector-remove"
                  onClick={() =>
                    void send(
                      { type: 'remove-connector', id: connector.id },
                      'Couldn’t remove it.',
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
              <>
                {connector.status === 'connected' && (
                  <>
                    <button
                      type="button"
                      className="connector-link"
                      disabled={checking}
                      onClick={() => {
                        setChecking(true);
                        setChecked(false);
                        void send(
                          { type: 'test-connector', id: connector.id },
                          `Couldn’t check ${connector.name}.`,
                        ).then(ok => {
                          setChecking(false);
                          setChecked(ok);
                        });
                      }}
                    >
                      {checking ? 'Checking…' : 'Test Connection'}
                    </button>
                    <button type="button" className="connector-link" onClick={connect}>
                      Reconnect
                    </button>
                  </>
                )}
                {checked && connector.status === 'connected' && (
                  <span className="connector-checked" role="status">
                    Works
                  </span>
                )}
                <button
                  type="button"
                  className="connector-link connector-link-danger"
                  onClick={() => setConfirming(true)}
                >
                  Remove
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

/** Connected apps and MCP servers: sign in, choose which tools Edi may use, remove. */
export function ConnectorsView() {
  const connectors = useConnectors();
  const [composioConfigured, refreshComposio] = useComposioConfigured();
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [keyRequest, setKeyRequest] = useState(0);
  const [search, setSearch] = useState('');
  const [showCustom, setShowCustom] = useState(false);

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

  async function addByAddress(url: string, name: string) {
    return send(
      { type: 'add-connector', url, ...(name ? { name } : {}) },
      'Couldn’t add that server.',
    );
  }

  async function addOnThisMac(local: LocalServer, name: string) {
    return send(
      { type: 'add-connector', local, ...(name ? { name } : {}) },
      'Couldn’t add that server.',
    );
  }

  const available = useMemo(() => {
    const added = new Set(connectors?.map(c => c.catalogId));
    return connectorCatalog.filter(
      entry => !added.has(entry.id) && (entry.provider !== 'composio' || composioConfigured),
    );
  }, [connectors, composioConfigured]);

  const filtered = useMemo(() => {
    if (!search.trim()) return available;
    const q = search.toLowerCase();
    return available.filter(
      e => e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q),
    );
  }, [available, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const entry of filtered) {
      const list = map.get(entry.category) ?? [];
      list.push(entry);
      map.set(entry.category, list);
    }
    return [...map.entries()].sort(
      ([a], [b]) => categoryOrder.indexOf(a) - categoryOrder.indexOf(b),
    );
  }, [filtered]);

  return (
    <section className="connectors-page">
      {error && (
        <p role="alert" className="workspace-error">
          {error}
        </p>
      )}

      {/* Connected apps */}
      {connectors && connectors.length > 0 && (
        <GroupedList
          title="Connected"
          footer="Read-only tools run without asking; anything that changes something is reviewed first."
        >
          {connectors.map(connector => (
            <ConnectedApp
              key={connector.id}
              connector={connector}
              expanded={expanded === connector.id}
              onToggle={() => setExpanded(expanded === connector.id ? null : connector.id)}
              onReplaceKey={() => setKeyRequest(n => n + 1)}
              send={send}
              composioConfigured={composioConfigured}
            />
          ))}
        </GroupedList>
      )}

      {/* Available apps */}
      {available.length > 0 && (
        <div className="connector-catalog">
          <div className="connector-catalog-header">
            <h2 className="ds-group-title">Add an app</h2>
            <div className="connector-popover-anchor">
              <button
                type="button"
                className="connector-add-btn"
                onClick={() => setShowCustom(prev => !prev)}
                aria-expanded={showCustom}
              >
                <Icon name="plus" size={14} />
                Add
              </button>
              {showCustom && (
                <CustomServerPopover
                  onAdd={addByAddress}
                  onAddLocal={addOnThisMac}
                  onClose={() => setShowCustom(false)}
                />
              )}
            </div>
          </div>
          {available.length > 3 && (
            <TextField
              label="Search apps"
              hideLabel
              placeholder="Search apps…"
              icon="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          )}
          {grouped.map(([category, entries]) => (
            <GroupedList key={category} title={categoryLabel[category] ?? category}>
              {entries.map(entry => (
                <GroupedRow
                  key={entry.id}
                  leading={<BrandIcon catalogId={entry.id} name={entry.name} />}
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
          ))}
          {search && filtered.length === 0 && (
            <p className="connector-empty">
              No apps match “{search}”.{' '}
              <button
                type="button"
                className="connector-link"
                onClick={() => {
                  setSearch('');
                  setShowCustom(true);
                }}
              >
                Add a custom server instead
              </button>
            </p>
          )}
        </div>
      )}

      <ComposioKey
        configured={composioConfigured}
        focusRequest={keyRequest}
        onChange={refreshComposio}
      />
    </section>
  );
}
