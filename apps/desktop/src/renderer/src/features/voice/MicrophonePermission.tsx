import { useEffect, useState } from 'react';
import { Button } from '../../components/ui';

/** Permission recovery never starts recording. The user holds Edi again when ready. */
export function MicrophonePermission({
  status,
  onDismiss,
}: {
  status: 'granted' | 'blocked';
  onDismiss: () => void;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'ask' | 'settings' | null>(null);
  useEffect(() => {
    const check = () => {
      void window.edi
        ?.command({ type: 'check-microphone-permission' })
        .catch(() => setError('Couldn’t check permission. Try again.'));
    };
    window.addEventListener('focus', check);
    return () => window.removeEventListener('focus', check);
  }, []);
  return (
    <section className="response-view" aria-labelledby="microphone-title">
      <h1 id="microphone-title" className="ds-title">
        {status === 'granted' ? 'You’re ready to talk' : 'Let Edi hear you'}
      </h1>
      <p className="content-paragraph">
        {status === 'granted'
          ? 'Microphone access is on. Hold Edi or your push-to-talk shortcut when you’re ready.'
          : 'Edi needs the microphone to hear you.'}
      </p>
      {status === 'blocked' && (
        <div className="response-actions">
          <Button
            variant="prominent"
            block
            disabled={busy !== null}
            onClick={async () => {
              setBusy('ask');
              setError('');
              try {
                const stream = await navigator.mediaDevices.getUserMedia({
                  audio: true,
                  video: false,
                });
                stream.getTracks().forEach(track => track.stop());
                await window.edi?.command({ type: 'check-microphone-permission' });
              } catch {
                try {
                  await window.edi?.command({ type: 'request-microphone-permission' });
                } catch {
                  setError('Couldn’t ask for the microphone. Try again.');
                }
              } finally {
                setBusy(null);
              }
            }}
          >
            {busy === 'ask' ? 'Asking…' : 'Allow Microphone'}
          </Button>
          <Button
            block
            disabled={busy !== null}
            onClick={async () => {
              setBusy('settings');
              setError('');
              try {
                await window.edi?.command({ type: 'open-microphone-settings' });
              } catch {
                setError(
                  'Couldn’t open Settings. Open System Settings → Privacy & Security → Microphone.',
                );
              } finally {
                setBusy(null);
              }
            }}
          >
            {busy === 'settings' ? 'Opening Settings…' : 'Open Microphone Settings'}
          </Button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      <Button variant="plain" block onClick={onDismiss}>
        {status === 'granted' ? 'Done' : 'Not now'}
      </Button>
      <p className="ds-footnote ds-tertiary">Allowing access won’t start a recording.</p>
    </section>
  );
}
