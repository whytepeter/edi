import { useState } from 'react';
import type { PermissionId, PermissionState } from '@edi/contracts';
import { Button } from '../../components/ui';

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
};

/** One state-driven card for every OS permission Edi supports. */
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
    <section className="response-view permission-card" aria-labelledby="permission-title">
      <h1 id="permission-title" className="ds-title">
        {words.title}
      </h1>
      <p className="content-paragraph">{words.body}</p>
      {restricted ? (
        <p role="note">This access is unavailable or restricted on this Mac.</p>
      ) : (
        <div className="response-actions">
          <Button variant="prominent" block disabled={busy} onClick={() => void act()}>
            {busy
              ? settings
                ? 'Opening Settings…'
                : 'Asking…'
              : settings
                ? words.settings
                : words.allow}
          </Button>
        </div>
      )}
      {permission.requested && permission.status === 'not-determined' && (
        <p role="status">Finish the request in macOS. You may need to reopen Edi afterward.</p>
      )}
      {error && <p role="alert">{error}</p>}
      <Button
        variant="plain"
        block
        onClick={() =>
          void window.edi?.command({ type: 'permission-dismiss', permission: permission.id })
        }
      >
        Not now
      </Button>
      <p className="ds-footnote ds-tertiary">{words.privacy}</p>
    </section>
  );
}
