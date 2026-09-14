import { useState } from 'react';
import type { ToolCallStatus, ToolStep } from '@edi/contracts';
import { Icon } from '../../components/ui';

const statusWord: Record<ToolCallStatus, string> = {
  'awaiting-approval': 'Waiting for you',
  running: 'Working',
  succeeded: 'Done',
  denied: 'Declined',
  failed: 'Didn’t work',
  cancelled: 'Stopped',
  unknown: 'Check it',
};

/**
 * What Edi did during a turn, folded into one quiet line (like Claude's tool use): the
 * current step while working, a count when finished. Tap to see each action.
 */
export function ActionTrail({ steps, working }: { steps: readonly ToolStep[]; working: boolean }) {
  const [open, setOpen] = useState(false);
  if (!steps.length) return null;
  const active =
    [...steps]
      .reverse()
      .find(step => step.status === 'running' || step.status === 'awaiting-approval') ?? null;
  const problems = steps.filter(step =>
    ['failed', 'unknown', 'denied'].includes(step.status),
  ).length;
  const label =
    working && active
      ? `${active.title}${active.status === 'awaiting-approval' ? ' — waiting for you' : '…'}`
      : `${steps.length} ${steps.length === 1 ? 'action' : 'actions'}${
          problems ? ` · ${problems} didn’t go through` : ''
        }`;
  return (
    <div
      className="action-trail"
      data-open={open || undefined}
      data-working={(working && active) || undefined}
    >
      <button
        type="button"
        className="action-trail-head"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <span
          className="action-trail-dot"
          data-status={active?.status ?? (problems ? 'failed' : 'succeeded')}
        />
        <span className="action-trail-label">{label}</span>
        <Icon name="chevron-down" size={13} />
      </button>
      {open && (
        <ol className="action-trail-list">
          {steps.map(step => (
            <li key={step.callId} data-status={step.status}>
              <span className="action-trail-dot" data-status={step.status} />
              <span className="action-trail-text">
                <span className="action-trail-title">{step.title}</span>
                {step.summary && <span className="action-trail-summary">{step.summary}</span>}
              </span>
              <span className="action-trail-status">{statusWord[step.status]}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
