import { useCallback, useEffect, useState } from 'react';
import {
  describeRule,
  type ApprovalRule,
  type FileAccess,
  type FileAccessAction,
  type FolderAccessStatus,
  type PermissionId,
  type PermissionSnapshot,
  type PermissionStatus,
  type WorkspaceView,
} from '@edi/contracts';
import { Button, type IconName, GroupedList, GroupedRow, Switch } from '../../components/ui';
import './settings.css';

const permissionCopy: Record<PermissionId, { title: string; detail: string; icon: IconName }> = {
  microphone: { title: 'Microphone', detail: 'For questions you ask out loud', icon: 'mic' },
  'screen-recording': {
    title: 'Screen Recording',
    detail: 'Only when a question is about your screen',
    icon: 'window',
  },
  accessibility: {
    title: 'Accessibility',
    detail: 'Selected text and the open document, when you ask',
    icon: 'sliders',
  },
  reminders: {
    title: 'Reminders',
    detail: 'To check and add reminders when you ask',
    icon: 'check',
  },
  calendar: {
    title: 'Calendar',
    detail: 'To check your schedule and add events when you ask',
    icon: 'calendar',
  },
};

const ruleIcon: Record<ApprovalRule['kind'], IconName> = {
  folder: 'folder',
  site: 'arrow-up-right',
  app: 'window',
  any: 'check',
};

const statusLabel: Record<PermissionStatus, string> = {
  granted: 'Allowed',
  'not-determined': 'Not asked yet',
  denied: 'Off',
  restricted: 'Restricted',
  unavailable: 'Unavailable',
  unknown: 'Checking…',
};

const folderStatus: Record<FolderAccessStatus, string> = {
  allowed: 'Allowed',
  off: 'Off',
  'not-checked': 'Not asked yet',
  missing: 'Not found',
};

/** Settings → Privacy & Permissions: OS access, what leaves this Mac, and the activity log. */
export function PrivacySettings({
  permissions,
  shareDesktopContext,
  onShareDesktopContext,
  onOpen,
}: {
  permissions: PermissionSnapshot;
  shareDesktopContext: boolean;
  onShareDesktopContext(enabled: boolean): void;
  onOpen(view: WorkspaceView): void;
}) {
  const [error, setError] = useState('');
  const [files, setFiles] = useState<FileAccess | null>(null);
  const [rules, setRules] = useState<ApprovalRule[]>([]);

  useEffect(() => {
    let alive = true;
    void window.edi
      ?.approvalRules()
      .then(list => alive && setRules(list))
      .catch(() => {});
    const stop = window.edi?.onApprovalRules(setRules);
    return () => {
      alive = false;
      stop?.();
    };
  }, []);

  async function removeRule(id: string) {
    setError('');
    try {
      await window.edi?.command({ type: 'remove-approval-rule', id });
    } catch {
      setError('Couldn’t remove that. Try again.');
    }
  }

  const loadFiles = useCallback(() => {
    void window.edi
      ?.fileAccess()
      .then(setFiles)
      .catch(() => {});
  }, []);
  useEffect(() => {
    loadFiles();
    // Access changes in System Settings; check again whenever the card comes back.
    window.addEventListener('focus', loadFiles);
    return () => window.removeEventListener('focus', loadFiles);
  }, [loadFiles]);

  async function fileAction(action: FileAccessAction) {
    setError('');
    try {
      const next = await window.edi?.fileAccessAction(action);
      if (next) setFiles(next);
    } catch {
      setError(
        action.type === 'add' ? 'Couldn’t add that folder.' : 'Couldn’t reach System Settings.',
      );
    }
  }

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

      <GroupedList
        title="What you’re working on"
        footer="With each question Edi includes the app and window in front, and, with Accessibility, the page address, the open document and any text you selected. Password managers and private windows are left out. Nothing is kept."
      >
        <GroupedRow
          icon="window"
          title="Share what’s in front of you"
          detail="So “this page” or “my selection” just works"
          control={
            <Switch
              label="Share what’s in front of you"
              checked={shareDesktopContext}
              onChange={onShareDesktopContext}
            />
          }
        />
      </GroupedList>

      {files && (
        <GroupedList
          title="Files & Folders"
          footer="Edi searches and reads files only in these folders. Renaming, moving, new folders and moving to the Trash always ask first. Full Disk Access lets Edi use everything in your home folder."
        >
          {files.folders.map(folder => (
            <GroupedRow
              key={folder.id}
              icon="folder"
              title={folder.name}
              detail={folder.path}
              value={
                folder.status === 'allowed' || folder.status === 'missing'
                  ? folderStatus[folder.status]
                  : undefined
              }
              control={
                folder.kind === 'added' ? (
                  <Button
                    size="small"
                    onClick={() => void fileAction({ type: 'remove', id: folder.id })}
                  >
                    Remove
                  </Button>
                ) : folder.status === 'not-checked' ? (
                  <Button
                    size="small"
                    onClick={() => void fileAction({ type: 'check', id: folder.id })}
                  >
                    Allow
                  </Button>
                ) : folder.status === 'off' ? (
                  <Button
                    size="small"
                    onClick={() => void fileAction({ type: 'open-settings', pane: 'files' })}
                  >
                    Open Settings
                  </Button>
                ) : undefined
              }
            />
          ))}
          <GroupedRow
            icon="shield"
            title="Full Disk Access"
            detail="Everything in your home folder, including other apps’ files"
            value={files.fullDiskAccess ? 'On' : undefined}
            control={
              !files.fullDiskAccess && (
                <Button
                  size="small"
                  onClick={() => void fileAction({ type: 'open-settings', pane: 'full-disk' })}
                >
                  Open Settings
                </Button>
              )
            }
          />
          <GroupedRow
            icon="folder"
            title="Add a folder…"
            detail="Choose another folder Edi can use"
            onOpen={() => void fileAction({ type: 'add' })}
          />
        </GroupedList>
      )}

      <GroupedList
        title="Always allowed"
        footer={
          rules.length
            ? 'Edi does these without asking. Remove one to be asked again.'
            : 'When you choose “Always allow” for a folder, a site, an app, or adding reminders and events, it shows here.'
        }
      >
        {rules.map(rule => (
          <GroupedRow
            key={rule.id}
            icon={ruleIcon[rule.kind]}
            title={rule.capabilityTitle}
            detail={describeRule(rule)}
            control={
              <Button size="small" onClick={() => void removeRule(rule.id)}>
                Remove
              </Button>
            }
          />
        ))}
      </GroupedList>

      <GroupedList title="What leaves this Mac">
        <li>
          <ul className="settings-prose">
            <li>
              Your questions, recent conversation, what you’re working on (when shared) and any
              screenshot a question needs go to OpenRouter with your key.
            </li>
            <li>
              When Edi reads one of your files to answer, that text goes to OpenRouter too. Your
              files themselves stay on this Mac.
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
