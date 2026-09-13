import { useState } from 'react';
import type {
  PermissionId,
  PermissionSnapshot,
  PermissionStatus,
  WorkspaceView,
} from '@edi/contracts';
import { Button, type IconName, GroupedList, GroupedRow } from '../../components/ui';
import './settings.css';

const permissionCopy: Record<PermissionId, { title: string; detail: string; icon: IconName }> = {
  microphone: { title: 'Microphone', detail: 'For questions you ask out loud', icon: 'mic' },
  'screen-recording': {
    title: 'Screen Recording',
    detail: 'Only when a question is about your screen',
    icon: 'window',
  },
};

const statusLabel: Record<PermissionStatus, string> = {
  granted: 'Allowed',
  'not-determined': 'Not asked yet',
  denied: 'Off',
  restricted: 'Restricted',
  unavailable: 'Unavailable',
  unknown: 'Checking…',
};

/** Settings → Privacy & Permissions: OS access, what leaves this Mac, and the activity log. */
export function PrivacySettings({
  permissions,
  onOpen,
}: {
  permissions: PermissionSnapshot;
  onOpen(view: WorkspaceView): void;
}) {
  const [error, setError] = useState('');

  async function act(permission: PermissionId, status: PermissionStatus) {
    setError('');
    try {
      await window.edi?.command({
        type: status === 'denied' ? 'permission-open-settings' : 'permission-request',
        permission,
      });
    } catch {
      setError('Couldn’t reach System Settings. Try again.');
    }
  }

  return (
    <div className="settings-page">
      {error && (
        <p role="alert" className="workspace-error">
          {error}
        </p>
      )}
      <GroupedList
        title="Permissions"
        footer="Edi asks for each one the first time a feature needs it."
      >
        {permissions.permissions.map(({ id, status }) => {
          const copy = permissionCopy[id];
          const actionable = status === 'denied' || status === 'not-determined';
          return (
            <GroupedRow
              key={id}
              icon={copy.icon}
              title={copy.title}
              detail={copy.detail}
              value={actionable ? undefined : statusLabel[status]}
              control={
                actionable && (
                  <Button size="small" onClick={() => void act(id, status)}>
                    {status === 'denied' ? 'Open Settings' : 'Allow'}
                  </Button>
                )
              }
            />
          );
        })}
      </GroupedList>

      <GroupedList title="What leaves this Mac">
        <li>
          <ul className="settings-prose">
            <li>
              Your questions, recent conversation, and any screenshot a question needs go to
              OpenRouter with your key.
            </li>
            <li>Voice recordings, transcription and speech stay on this Mac.</li>
            <li>Edi doesn’t collect usage analytics.</li>
          </ul>
        </li>
      </GroupedList>

      <GroupedList>
        <GroupedRow
          icon="clock"
          title="Activity"
          detail="Every request, and each action Edi took or you refused"
          onOpen={() => onOpen('settings.activity')}
        />
      </GroupedList>
    </div>
  );
}
