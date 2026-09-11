import { useState } from 'react';
import { Button } from '../../components/ui';
import { askForScreenRecording } from '../../lib/ask-screen-recording';

/** First launch ask. The system prompt runs only when the user allows it here. */
export function ScreenRecordingPermission({ onDismiss }: { onDismiss: () => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState(false);
  return (
    <section className="response-view" aria-labelledby="screen-title">
      <h1 id="screen-title" className="ds-title">
        Let Edi see your screen
      </h1>
      <p className="content-paragraph">
        Edi looks at your screen when you ask, so it can answer what you see.
      </p>
      <div className="response-actions">
        <Button
          variant="prominent"
          block
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              if (!(await askForScreenRecording())) setAsked(true);
            } catch {
              setError('Couldn’t ask for Screen Recording. Try again.');
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Asking…' : 'Allow Screen Recording'}
        </Button>
      </div>
      {asked && (
        <p>
          If macOS asks, allow Edi. Then quit Edi and open it again.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <Button variant="plain" block onClick={onDismiss}>
        Not now
      </Button>
    </section>
  );
}
