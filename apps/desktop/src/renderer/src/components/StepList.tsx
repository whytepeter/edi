import type { ToolCallStatus, ToolStep } from '@edi/contracts';
import './step-list.css';

/** Plain-language status for each tool call. `unknown` asks the person to check. */
const statusLabel: Record<ToolCallStatus, string> = {
  'awaiting-approval': 'Needs your OK',
  running: 'Working…',
  succeeded: 'Done',
  denied: 'Declined',
  failed: 'Didn’t work',
  cancelled: 'Stopped',
  unknown: 'Check the result',
};

export function StepList({
  steps,
  label = 'Actions',
}: {
  steps: readonly ToolStep[];
  label?: string;
}) {
  if (!steps.length) return null;
  return (
    <ul className="step-list" aria-label={label}>
      {steps.map(step => (
        <li key={step.callId} className="step" data-status={step.status}>
          <span className="step-dot" aria-hidden="true" />
          <div>
            <p className="step-title">
              {step.title}
              <span className="step-status">{statusLabel[step.status]}</span>
            </p>
            {step.summary && <p className="step-summary">{step.summary}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}
