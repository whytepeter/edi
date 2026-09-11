import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { IconButton, Menu, ToolbarGroup } from '../components/ui';
import { accentFor, type Command } from '../lib/bridge';
import { useSettings } from '../hooks/useSettings';
import { useAgentState } from '../hooks/useAgentState';
import { ApprovalSheet } from '../features/conversation/ApprovalSheet';
import { Pet } from '../components/Pet';
import { IntroView } from '../features/content/IntroView';
import { AgentPanel } from '../features/conversation/AgentPanel';
import { AppearanceView } from '../features/appearance/AppearanceView';
import { ExtensionsView } from '../features/extensions/ExtensionsView';
import { ActivityView } from '../features/activity/ActivityView';
import './workspace.css';

type View = 'content' | 'agent' | 'avatars' | 'extensions' | 'activity';

/** The floating content card: navigation, card controls, and the active view. */
export function WorkspaceCard() {
  const { settings, setSettings, error: loadError } = useSettings();
  const { state: agent } = useAgentState();
  // While a review is pending, everything else in the card is inert.
  const blocked = agent.approval !== null;
  const blockedRef = useRef(blocked);
  useEffect(() => {
    blockedRef.current = blocked;
  }, [blocked]);
  const [view, setView] = useState<View>('content');
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState('');
  const moreButton = useRef<HTMLButtonElement>(null);

  async function send(command: Command) {
    try {
      if (window.edi) await window.edi.command(command);
      // Plain-browser preview: apply presentation changes locally.
      else if (command.type === 'apply-skin') setSettings(s => ({ ...s, skin: command.skin }));
      else if (command.type === 'set-pinned') setSettings(s => ({ ...s, pinned: command.pinned }));
      return true;
    } catch {
      setError('Couldn’t make that change. Try again.');
      return false;
    }
  }

  function closeMenu() {
    setMenuOpen(false);
    moreButton.current?.focus();
  }

  function navigate(next: View) {
    setView(next);
    setMenuOpen(false);
  }

  useEffect(() => {
    // The menu handles its own Escape; this only fires when it is closed.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !blockedRef.current) {
        void window.edi?.command({ type: 'hide-workspace' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const shownError = error || loadError;

  return (
    <div
      className="workspace-card ds-card"
      data-accent
      data-expanded={expanded || undefined}
      style={{ '--accent': accentFor(settings.skin) } as CSSProperties}
    >
      <main className="workspace-content" inert={blocked}>
        {shownError && (
          <div role="alert" className="workspace-error">
            {shownError}
          </div>
        )}
        {view === 'content' && <IntroView skin={settings.skin} onTalk={() => navigate('agent')} />}
        {view === 'agent' && <AgentPanel />}
        {view === 'avatars' && (
          <AppearanceView
            skin={settings.skin}
            onApply={skin => void send({ type: 'apply-skin', skin })}
          />
        )}
        {view === 'extensions' && <ExtensionsView onOpenAppearance={() => navigate('avatars')} />}
        {view === 'activity' && <ActivityView refreshKey={`${agent.runId}:${agent.status}`} />}
      </main>

      <div className="ds-scroll-edge" data-edge="top" />
      <div className="ds-scroll-edge" data-edge="bottom" />

      <header className="workspace-header" inert={blocked}>
        <div className="workspace-identity">
          {view === 'content' ? (
            <span className="workspace-avatar">
              <Pet skin={settings.skin} />
            </span>
          ) : (
            <ToolbarGroup>
              <IconButton icon="back" label="Back to content" onClick={() => navigate('content')} />
            </ToolbarGroup>
          )}
          <span className="workspace-wordmark">edi</span>
        </div>
        <ToolbarGroup label="Card controls">
          <IconButton
            icon="pin"
            label={settings.pinned ? 'Unpin card' : 'Pin card'}
            aria-pressed={settings.pinned}
            onClick={() => void send({ type: 'set-pinned', pinned: !settings.pinned })}
          />
          <IconButton
            icon={expanded ? 'collapse' : 'expand'}
            label={expanded ? 'Collapse card' : 'Expand card'}
            aria-expanded={expanded}
            onClick={async () => {
              if (await send({ type: 'set-expanded', expanded: !expanded })) setExpanded(!expanded);
            }}
          />
          <IconButton
            ref={moreButton}
            icon="more"
            label="More options"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(open => !open)}
          />
          <IconButton
            icon="close"
            label="Dismiss card"
            onClick={() => void send({ type: 'hide-workspace' })}
          />
        </ToolbarGroup>
      </header>

      {menuOpen && (
        <>
          <button className="workspace-menu-dismiss" aria-label="Close menu" onClick={closeMenu} />
          <Menu
            label="More"
            className="workspace-menu"
            onDismiss={closeMenu}
            items={[
              {
                id: 'agent',
                label: 'Talk to Edi',
                icon: 'chat',
                onSelect: () => navigate('agent'),
              },
              {
                id: 'avatars',
                label: 'Appearance',
                icon: 'face',
                onSelect: () => navigate('avatars'),
              },
              {
                id: 'extensions',
                label: 'Extensions',
                icon: 'sparkles',
                onSelect: () => navigate('extensions'),
              },
              {
                id: 'activity',
                label: 'Activity',
                icon: 'clock',
                onSelect: () => navigate('activity'),
              },
            ]}
          />
        </>
      )}

      <footer className="workspace-footer ds-glass" inert={blocked}>
        <span className="ds-status-dot" aria-hidden="true" />
        <span>Here when you need me</span>
        <kbd aria-label="Command Shift E">⌘⇧E</kbd>
      </footer>

      {agent.approval && <ApprovalSheet key={agent.approval.callId} approval={agent.approval} />}
    </div>
  );
}
