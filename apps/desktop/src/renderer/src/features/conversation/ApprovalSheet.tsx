import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { ApprovalRequest } from '@edi/contracts';
import { Button } from '../../components/ui';
import './approval.css';

/** Guards against a click or keystroke that was already in flight when the sheet appeared. */
const ARM_DELAY_MS = 600;

/**
 * Review for one prepared action. Modal over the card: the rest of the card is
 * dimmed and inert until the person decides. Escape declines.
 */
export function ApprovalSheet({ approval }: { approval: ApprovalRequest }) {
  const [armed, setArmed] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const sheet = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const summaryId = useId();
  const { callId, preview } = approval;

  // Keyed by call ID in the parent, so each review mounts fresh and unarmed.
  useEffect(() => {
    sheet.current?.focus();
    const timer = setTimeout(() => setArmed(true), ARM_DELAY_MS);
    return () => clearTimeout(timer);
  }, [callId]);

  async function respond(decision: 'approve' | 'deny') {
    setSending(true);
    setError('');
    try {
      await window.edi?.command({ type: 'respond-approval', callId, decision });
    } catch {
      setError('That request is no longer pending.');
      setSending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    if (!sending) void respond('deny');
  }

  return (
    <div className="approval-scrim">
      <div
        ref={sheet}
        className="approval-sheet ds-glass"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={summaryId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <p className="ds-eyebrow">Edi needs your OK</p>
        <h2 id={titleId} className="ds-title">
          {preview.title}
        </h2>
        <p id={summaryId} className="ds-callout ds-secondary">
          {preview.summary}
        </p>
        {preview.fields.length > 0 && (
          <dl className="approval-fields">
            {preview.fields.map(field => (
              <div key={field.label}>
                <dt>{field.label}</dt>
                <dd>{field.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {preview.body && (
          <pre className="approval-body" aria-label="Content preview" tabIndex={0}>
            {preview.body}
          </pre>
        )}
        {error && (
          <p role="alert" className="approval-error">
            {error}
          </p>
        )}
        <div className="approval-actions">
          <Button disabled={sending} onClick={() => void respond('deny')}>
            Don’t Allow
          </Button>
          <Button
            variant="prominent"
            disabled={!armed || sending}
            onClick={() => void respond('approve')}
          >
            {preview.action}
          </Button>
        </div>
      </div>
    </div>
  );
}
