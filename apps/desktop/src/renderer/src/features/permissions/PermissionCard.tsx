import { useState } from 'react';
import type { PermissionId, PermissionState } from '@edi/contracts';
import { Button, Icon, type IconName } from '../../components/ui';
import './permission-card.css';

const icons: Record<PermissionId, IconName> = {
  microphone: 'mic',
  'screen-recording': 'window',
  accessibility: 'shield',
  reminders: 'tasks',
  calendar: 'calendar',
};

const copy: Record<
  PermissionId,
  { title: string; body: string; allow: string; settings: string; privacy: string }
> = {
  microphone: {
    title: 'Let Edi hear you',
    body: 'Edi needs the microphone when you ask a question out loud.',
    allow: 'Allow Microphone',
    settings: 'Open Microphone Settings',
    privacy: 'Allowing access won’t start a recording.',
  },
  'screen-recording': {
    title: 'Let Edi see your screen',
    body: 'This question refers to something on screen. Edi needs Screen Recording to see it.',
    allow: 'Allow Screen Recording',
    settings: 'Open Screen Recording Settings',
    privacy: 'Edi captures your screens only when your question needs them.',
  },
  accessibility: {
    title: 'Let Edi see what you selected',
    body: 'With Accessibility, Edi can read the text you selected and which document is open.',
    allow: 'Allow Accessibility',
    settings: 'Open Accessibility Settings',
    privacy: 'Edi reads these only when you ask something, and never controls other apps.',
  },
  reminders: {
    title: 'Let Edi use Reminders',
    body: 'Edi needs Reminders to check or add reminders for you.',
    allow: 'Allow Reminders',
    settings: 'Open Reminders Settings',
    privacy: 'Edi reads reminders only when you ask, and asks before adding any.',
  },
  calendar: {
    title: 'Let Edi use your Calendar',
    body: 'Edi needs Calendar to check your schedule or add events for you.',
    allow: 'Allow Calendar',
    settings: 'Open Calendar Settings',
    privacy: 'Edi reads events only when you ask, and asks before adding any.',
  },
};

/**
 * One state-driven card for every OS permission Edi supports. It takes over the whole content
 * area, whatever page is open, so the ask is the only thing on screen until it's answered.
 */
export function PermissionCard({ permission }: { permission: PermissionState }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const words = copy[permission.id];
  const settings = permission.status === 'denied';
  const restricted = permission.status === 'restricted' || permission.status === 'unavailable';
  const act = async () => {
    setBusy(true);
    setError('');
    try {
      await window.edi?.command({
        type: settings ? 'permission-open-settings' : 'permission-request',
        permission: permission.id,
      });
    } catch {
      setError(
        settings
          ? 'Couldn’t open System Settings. Try again.'
          : 'Couldn’t ask for access. Try again.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="permission-card" aria-labelledby="permission-title">
      <div className="permission-card-body">
        <span className="permission-card-icon" aria-hidden="true">
          <Icon name={icons[permission.id]} size={26} />
        </span>
        <h1 id="permission-title" className="ds-title">
          {words.title}
        </h1>
        <p className="permission-card-text">{words.body}</p>
        {restricted ? (
          <p role="note" className="permission-card-note">
            This access is unavailable or restricted on this Mac.
          </p>
        ) : (
          <Button variant="prominent" block disabled={busy} onClick={() => void act()}>
            {busy
              ? settings
                ? 'Opening Settings…'
                : 'Asking…'
              : settings
                ? words.settings
                : words.allow}
          </Button>
        )}
        {permission.requested && permission.status === 'not-determined' && (
          <p role="status" className="permission-card-note">
            Finish the request in macOS. You may need to reopen Edi afterward.
          </p>
        )}
        {error && (
          <p role="alert" className="permission-card-error">
            {error}
          </p>
        )}
        <Button
          variant="plain"
          block
          onClick={() =>
            void window.edi?.command({ type: 'permission-dismiss', permission: permission.id })
          }
        >
          Not now
        </Button>
        <p className="permission-card-privacy">{words.privacy}</p>
      </div>
    </section>
  );
}
