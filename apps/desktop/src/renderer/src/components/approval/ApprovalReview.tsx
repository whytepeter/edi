import type { ApprovalRequest } from '@edi/contracts';

/**
 * Everything a review shows beyond its one-line summary: each field of the prepared action and
 * the full change. The conversation's review sheet and a background task's review both show it,
 * so nothing is approved from a summary alone.
 */
export function ApprovalReview({
  preview,
  bodyId,
}: {
  preview: ApprovalRequest['preview'];
  /** Id for the change itself, when a dialog describes itself by it. */
  bodyId?: string;
}) {
  if (!preview.fields.length && !preview.body) return null;
  return (
    <div className="approval-review">
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
        <pre id={bodyId} className="approval-body" aria-label="What will change" tabIndex={0}>
          {preview.body}
        </pre>
      )}
    </div>
  );
}
