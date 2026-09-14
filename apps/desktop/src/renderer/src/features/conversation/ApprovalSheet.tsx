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

  async function respond(decision: 'approve' | 'approve-always' | 'deny') {
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
        aria-describedby={preview.body ? summaryId : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <p className="approval-kind">{approval.capability.title}</p>
        <h2 id={titleId} className="approval-question">
          {preview.summary}
        </h2>
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
          <pre id={summaryId} className="approval-body" aria-label="What will change" tabIndex={0}>
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
            Deny
          </Button>
          <Button
            variant="prominent"
            disabled={!armed || sending}
            onClick={() => void respond('approve')}
          >
            {preview.action}
          </Button>
        </div>
        <button
          type="button"
          className="approval-always"
          disabled={!armed || sending}
          onClick={() => void respond('approve-always')}
        >
          Always allow “{approval.capability.title}” in this chat
        </button>
      </div>
    </div>
  );
}
