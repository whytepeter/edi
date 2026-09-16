import { GroupedList, GroupedRow } from '../../components/ui';
import './settings.css';
import type { AgentState, PermissionSnapshot, SystemInfo, WorkspaceView } from '@edi/contracts';

interface SettingsViewProps {
  agent: AgentState;
  system: SystemInfo | null;
  permissions: PermissionSnapshot;
  onOpen(view: WorkspaceView): void;
}

/**
 * Only settings that control something real are listed. Behavior, Computer Use and
 * other groups join this list when the features behind them ship.
 */
export function SettingsView({ agent, system, permissions, onOpen }: SettingsViewProps) {
  const needsAccess = permissions.permissions.filter(p => p.status === 'denied').length;
  return (
    <div className="settings-page">
      <GroupedList>
        <GroupedRow
          icon="cpu"
          title="AI"
          value={agent.configured ? agent.model : 'Not connected'}
          onOpen={() => onOpen('settings.ai')}
        />
        <GroupedRow
          icon="waveform"
          title="Voice"
          value={system ? (system.voice.available ? system.voice.name : 'Unavailable') : ''}
          onOpen={() => onOpen('settings.voice')}
        />
        <GroupedRow icon="chart" title="Usage" onOpen={() => onOpen('settings.usage')} />
        <GroupedRow
          icon="keyboard"
          title="Keyboard"
          value={system?.pushToTalk.label ?? ''}
          onOpen={() => onOpen('settings.keyboard')}
        />
      </GroupedList>
      <GroupedList>
        <GroupedRow
          icon="shield"
          title="Privacy & Permissions"
          value={needsAccess > 0 ? `${needsAccess} off` : ''}
          onOpen={() => onOpen('settings.privacy')}
        />
        <GroupedRow
          icon="sparkles"
          title="Memory"
          onOpen={() => onOpen('settings.memory')}
        />
        <GroupedRow icon="info" title="About Edi" onOpen={() => onOpen('settings.about')} />
      </GroupedList>
    </div>
  );
}
