import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { assistantName, type ArtifactRef, type WorkspaceView } from '@edi/contracts';
import { Icon, IconButton, Menu, ToolbarGroup } from '../components/ui';
import { accentFor, type Command } from '../lib/bridge';
import { useSettings } from '../hooks/useSettings';
import { AssistantNameContext } from '../hooks/useAssistantName';
import { useAgentState } from '../hooks/useAgentState';
import { usePermissions } from '../hooks/usePermissions';
import { ApprovalSheet } from '../features/conversation/ApprovalSheet';
import { Pet } from '../components/Pet';
import { AgentPanel } from '../features/conversation/AgentPanel';
import { HomeView } from '../features/home/HomeView';
import { AppearanceView } from '../features/appearance/AppearanceView';
import { LibraryView } from '../features/library/LibraryView';
import { SkillsView } from '../features/skills/SkillsView';
import { ConnectorsView } from '../features/connectors/ConnectorsView';
import { ActivityView } from '../features/activity/ActivityView';
import { PermissionCard } from '../features/permissions/PermissionCard';
import { SettingsView } from '../features/settings/SettingsView';
import { AiSettings } from '../features/settings/AiSettings';
import { VoiceSettings } from '../features/settings/VoiceSettings';
import { UsageSettings } from '../features/settings/UsageSettings';
import { KeyboardSettings } from '../features/settings/KeyboardSettings';
import { PrivacySettings } from '../features/settings/PrivacySettings';
import { AboutSettings } from '../features/settings/AboutSettings';
import { useSystemInfo } from '../features/settings/useSystemInfo';
import {
  parentOf,
  primaryDestinations,
  sectionOf,
  settingsDestination,
  titleOf,
  type Destination,
} from './navigation';
// Response and permission cards share the content block styles.
import '../features/content/content.css';
import './workspace.css';

/** The floating card: section navigation, card controls, and the active view. */
export function WorkspaceCard() {
  const { settings, setSettings, error: loadError } = useSettings();
  const { state: agent } = useAgentState();
  // While a review is pending, everything else in the card is inert.
  const blocked = agent.approval !== null;
  const blockedRef = useRef(blocked);
  useEffect(() => {
    blockedRef.current = blocked;
  }, [blocked]);
  const [view, setView] = useState<WorkspaceView>('home');
  const permissionSnapshot = usePermissions();
  const activePermission = permissionSnapshot.permissions.find(
    permission => permission.id === permissionSnapshot.active,
  );
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState('');
  const navButton = useRef<HTMLButtonElement>(null);
  const section = sectionOf(view);
  const parent = parentOf(view);
  // Refetched on each visit to Home or Settings: voice and shortcut availability can change.
  const [system, refreshSystem] = useSystemInfo(
    section === 'settings' || section === 'home' ? view : null,
  );
  const refreshKey = `${agent.runId}:${agent.status}`;

  useEffect(() => {
    return window.edi?.onNavigate(setView);
  }, []);

  // Edi answers "where am I?" from what the card actually shows.
  useEffect(() => {
    void window.edi?.command({ type: 'workspace-view', view }).catch(() => {});
  }, [view]);

  async function send(command: Command) {
    try {
      setError('');
      if (window.edi) await window.edi.command(command);
      // Plain-browser preview: apply presentation changes locally.
      else if (command.type === 'apply-skin') setSettings(s => ({ ...s, skin: command.skin }));
      else if (command.type === 'set-name') setSettings(s => ({ ...s, name: command.name }));
      else if (command.type === 'set-pinned') setSettings(s => ({ ...s, pinned: command.pinned }));
      else if (command.type === 'set-pet-scale')
        setSettings(s => ({ ...s, petScale: command.scale }));
      else if (command.type === 'set-speak-replies')
        setSettings(s => ({ ...s, speakReplies: command.enabled }));
      else if (command.type === 'set-voice-model')
        setSettings(s => ({ ...s, voiceModel: command.model }));
      else if (command.type === 'set-voice')
        setSettings(s => ({
          ...s,
          voiceModel: command.selection.model,
          voices: { ...s.voices, [command.selection.model]: command.selection.voice },
        }));
      return true;
    } catch {
      setError('Couldn’t make that change. Try again.');
      return false;
    }
  }

  function closeMenu() {
    setMenuOpen(false);
    navButton.current?.focus();
  }

  // Shown content opens in its own window beside the card; the page underneath stays put.
  const openArtifact = (ref: ArtifactRef) => void send({ type: 'open-artifact', ref });

  function navigate(next: WorkspaceView) {
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
  const toMenuItem = (destination: Destination) => ({
    id: destination.id,
    label: destination.label,
    icon: destination.icon,
    onSelect: () => navigate(destination.id),
  });
  const sidebarLink = (destination: Destination) => (
    <li key={destination.id}>
      <button
        type="button"
        className="workspace-sidebar-link"
        aria-current={section === destination.id ? 'page' : undefined}
        onClick={() => navigate(destination.id)}
      >
        <Icon name={destination.icon} size={16} />
        {destination.label}
      </button>
    </li>
  );

  return (
    <AssistantNameContext.Provider value={assistantName(settings)}>
      <div
        className="workspace-card ds-card glass-window"
        data-accent
        data-view={view}
        data-section={section}
        data-expanded={expanded || undefined}
        style={{ '--accent': accentFor(settings.skin) } as CSSProperties}
      >
        {expanded && (
          <nav className="workspace-sidebar" aria-label="Edi sections" inert={blocked}>
            <div className="workspace-brand">
              <span className="workspace-avatar">
                <Pet skin={settings.skin} />
              </span>
              <span className="workspace-wordmark">edi</span>
            </div>
            <ul className="workspace-sidebar-list">{primaryDestinations.map(sidebarLink)}</ul>
            <ul className="workspace-sidebar-list">{sidebarLink(settingsDestination)}</ul>
          </nav>
        )}

        <div className="workspace-pane">
          <main className="workspace-content" inert={blocked}>
            {shownError && (
              <div role="alert" className="workspace-error">
                {shownError}
              </div>
            )}
            {activePermission && <PermissionCard permission={activePermission} />}
            <div className="workspace-view" hidden={Boolean(activePermission)}>
              {view === 'home' && (
                <HomeView
                  skin={settings.skin}
                  agent={agent}
                  system={system}
                  refreshKey={refreshKey}
                  onOpen={navigate}
                  onAsk={async prompt => {
                    const sent = await send({ type: 'ask-agent', prompt });
                    if (sent) navigate('conversations');
                    return sent;
                  }}
                />
              )}
              {view === 'conversations' && (
                <AgentPanel onSetUp={() => navigate('settings.ai')} onOpenArtifact={openArtifact} />
              )}
              {view === 'library' && <LibraryView refreshKey={refreshKey} onOpen={openArtifact} />}
              {view === 'skills' && <SkillsView />}
              {view === 'connectors' && <ConnectorsView />}
              {view === 'appearance' && (
                <AppearanceView
                  skin={settings.skin}
                  scale={settings.petScale}
                  customName={settings.name}
                  onApply={skin => void send({ type: 'apply-skin', skin })}
                  onName={name => send({ type: 'set-name', name })}
                  onScale={(scale, commit) => void send({ type: 'set-pet-scale', scale, commit })}
                />
              )}
              {view === 'settings' && (
                <SettingsView
                  agent={agent}
                  system={system}
                  permissions={permissionSnapshot}
                  onOpen={navigate}
                />
              )}
              {view === 'settings.ai' && <AiSettings />}
              {view === 'settings.voice' && (
                <VoiceSettings
                  system={system}
                  voiceModel={settings.voiceModel}
                  voices={settings.voices}
                  speakReplies={settings.speakReplies}
                  onVoiceModel={model => void send({ type: 'set-voice-model', model })}
                  onVoice={selection => void send({ type: 'set-voice', selection })}
                  onPreview={async selection => {
                    await window.edi?.command({ type: 'preview-voice', selection });
                  }}
                  onSpeakReplies={enabled => void send({ type: 'set-speak-replies', enabled })}
                  onKeysChanged={refreshSystem}
                />
              )}
              {view === 'settings.keyboard' && <KeyboardSettings system={system} />}
              {view === 'settings.privacy' && (
                <PrivacySettings permissions={permissionSnapshot} onOpen={navigate} />
              )}
              {view === 'settings.usage' && <UsageSettings refreshKey={refreshKey} />}
              {view === 'settings.activity' && <ActivityView refreshKey={refreshKey} />}
              {view === 'settings.about' && <AboutSettings system={system} />}
            </div>
          </main>

          <div className="ds-scroll-edge" data-edge="top" />
          <div className="ds-scroll-edge" data-edge="bottom" />

          <header className="workspace-header" inert={blocked}>
            <div className="workspace-identity">
              {parent && (
                <ToolbarGroup>
                  <IconButton
                    icon="back"
                    label={`Back to ${titleOf(parent)}`}
                    onClick={() => navigate(parent)}
                  />
                </ToolbarGroup>
              )}
              {parent || expanded ? (
                <span className="workspace-title">{titleOf(view)}</span>
              ) : (
                <button
                  ref={navButton}
                  type="button"
                  className="workspace-nav-trigger"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-label={`${titleOf(view)}, choose a section`}
                  onClick={() => setMenuOpen(open => !open)}
                >
                  <span className="workspace-avatar">
                    <Pet skin={settings.skin} />
                  </span>
                  <span className="workspace-title">{titleOf(view)}</span>
                  <Icon name="chevron-down" size={14} />
                </button>
              )}
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
                  setMenuOpen(false);
                  if (await send({ type: 'set-expanded', expanded: !expanded }))
                    setExpanded(!expanded);
                }}
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
              <button
                className="workspace-menu-dismiss"
                aria-label="Close menu"
                onClick={closeMenu}
              />
              <Menu
                label="Sections"
                className="workspace-menu"
                onDismiss={closeMenu}
                items={[
                  ...primaryDestinations.map(toMenuItem),
                  { separator: true },
                  toMenuItem(settingsDestination),
                ]}
              />
            </>
          )}
        </div>

        {agent.approval && <ApprovalSheet key={agent.approval.callId} approval={agent.approval} />}
      </div>
    </AssistantNameContext.Provider>
  );
}
