import { useId, useState, type ReactNode } from 'react';
import { alwaysAllowLabel, connectorCatalog, type ApprovalRequest } from '@edi/contracts';
import { BrandIcon } from '../BrandIcon';
import { Icon, type IconName } from '../ui';
import './approval-card.css';

export type ApprovalDecision = 'approve' | 'approve-always' | 'deny';

/** Edi's own tools, by the family in their id: an icon and the label above the question. */
const families: Record<string, { icon: IconName; label: string }> = {
  notes: { icon: 'notes', label: 'Notes' },
  workspace: { icon: 'library', label: 'Edi Workspace' },
  files: { icon: 'folder', label: 'Files' },
  mac: { icon: 'window', label: 'Mac' },
  calendar: { icon: 'calendar', label: 'Calendar' },
  reminders: { icon: 'tasks', label: 'Reminders' },
  web: { icon: 'search', label: 'Web' },
  tasks: { icon: 'clock', label: 'Background Task' },
  schedules: { icon: 'clock', label: 'Schedule' },
  skills: { icon: 'sparkles', label: 'Skills' },
  edi: { icon: 'plug', label: 'Edi' },
};

function source(approval: ApprovalRequest) {
  const { app, id, title } = approval.capability;
  if (app) {
    const entry = connectorCatalog.find(item => item.name === app);
    return {
      label: app,
      icon: <BrandIcon catalogId={entry?.id ?? null} name={app} />,
    };
  }
  const family = families[id.split('.')[0] ?? ''];
  return {
    label: family?.label ?? title,
    icon: (
      <span className="approval-card-tile" aria-hidden="true">
        <Icon name={family?.icon ?? 'shield'} size={16} />
      </span>
    ),
  };
}

/** Paths read shorter from the home folder: “~/Documents/Edi/Notes/plan.md”. */
const homeRelative = (value: string) => value.replace(/^\/Users\/[^/]+(?=\/|$)/, '~');

/** One short line under the question: the target for a single item, the first few for a batch. */
export function approvalDetail(approval: ApprovalRequest) {
  const { fields, body } = approval.preview;
  const to = fields.find(field => field.label === 'To' || field.label === 'Location');
  if (to) return homeRelative(to.value);
  if (fields[0]) return homeRelative(fields[0].value);
  if (!body) return '';
  const lines = body.split('\n').filter(Boolean);
  const shown = lines.slice(0, 2).join(', ');
  return lines.length > 2 ? `${shown} +${lines.length - 2} more` : shown;
}

/**
 * A request to act, laid out like a macOS notification: the app's tile, where it comes from, the
 * question and one detail line; then a row to stop asking, and two equal buttons. The same card
 * sits in the bubble beside Edi (compact, with Details) and in the conversation (with the full
 * review as `children`).
 */
export function ApprovalCard({
  approval,
  armed,
  sending,
  error,
  compact = false,
  titleId,
  onRespond,
  onDetails,
  children,
}: {
  approval: ApprovalRequest;
  /** False for a moment after it appears, so a click already in flight can't approve. */
  armed: boolean;
  sending: boolean;
  error: string;
  compact?: boolean;
  titleId?: string;
  onRespond(decision: ApprovalDecision): void;
  onDetails?(): void;
  children?: ReactNode;
}) {
  const [always, setAlways] = useState(false);
  const fallbackId = useId();
  const headingId = titleId ?? fallbackId;
  const { label, icon } = source(approval);
  const detail = compact ? approvalDetail(approval) : '';

  return (
    <section
      className="approval-card"
      data-compact={compact || undefined}
      aria-labelledby={headingId}
    >
      <header className="approval-card-head">
        {icon}
        <div className="approval-card-text">
          <p className="approval-card-source">
            <span>{label}</span>
            {onDetails && (
              <button type="button" disabled={sending} onClick={onDetails}>
                Details
                <Icon name="chevron-right" size={11} />
              </button>
            )}
          </p>
          <h2 id={headingId}>{approval.preview.summary}</h2>
          {detail && <p className="approval-card-detail">{detail}</p>}
        </div>
      </header>
      {children}
      <label className="approval-card-always">
        <span className="approval-card-badge" aria-hidden="true">
          <Icon name="shield" size={13} />
        </span>
        <span>
          {alwaysAllowLabel(approval, compact)}
          {!compact && <small>You can change this in Settings › Privacy.</small>}
        </span>
        <input
          type="checkbox"
          className="approval-card-check"
          checked={always}
          disabled={sending}
          onChange={event => setAlways(event.target.checked)}
        />
      </label>
      {error && (
        <p role="alert" className="approval-card-error">
          {error}
        </p>
      )}
      <div className="approval-card-actions">
        <button
          type="button"
          className="approval-card-button"
          disabled={sending}
          onClick={() => onRespond('deny')}
        >
          Deny
        </button>
        <button
          type="button"
          className="approval-card-button"
          data-primary
          disabled={!armed || sending}
          onClick={() => onRespond(always ? 'approve-always' : 'approve')}
        >
          {approval.preview.action}
        </button>
      </div>
    </section>
  );
}
