import { z } from 'zod';

/**
 * What a person reviews before Edi performs a write. It describes the exact
 * prepared effect (for example the final file path), not the model's intent.
 */
export const approvalPreviewSchema = z
  .object({
    title: z.string().min(1).max(120),
    /** The confirm button's label: a specific verb, e.g. “Save Note”, never just “OK”. */
    action: z.string().min(1).max(40),
    summary: z.string().min(1).max(240),
    fields: z
      .array(z.object({ label: z.string().min(1).max(40), value: z.string().max(600) }).strict())
      .max(8),
    /** Content preview, truncated by the capability. */
    body: z.string().max(4000).optional(),
  })
  .strict();
export type ApprovalPreview = z.infer<typeof approvalPreviewSchema>;

/**
 * awaiting-approval → denied | running → succeeded | failed | unknown; cancelled from any
 * pending state. `unknown` means the effect may have happened and must not be retried blindly.
 */
export const toolCallStatusSchema = z.enum([
  'awaiting-approval',
  'denied',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'unknown',
]);
export type ToolCallStatus = z.infer<typeof toolCallStatusSchema>;

export const toolStepSchema = z
  .object({
    callId: z.string().uuid(),
    capability: z.string().min(1).max(80),
    title: z.string().min(1).max(120),
    status: toolCallStatusSchema,
    summary: z.string().max(400),
  })
  .strict();
export type ToolStep = z.infer<typeof toolStepSchema>;

/**
 * Where an "Always allow" for this action would apply, so it can outlive the conversation:
 * a folder (every path the action touches is inside it), a site (every address is on it),
 * an app, or `any` for additive actions such as adding a reminder. Actions without a scope
 * can only be allowed for the current conversation.
 */
export const approvalScopeSchema = z
  .object({
    kind: z.enum(['folder', 'site', 'app', 'any']),
    /** A real folder path, a host name, or an app bundle path; empty for `any`. */
    value: z.string().max(1024),
    /** How people see it: “~/Desktop”, “github.com”, “Safari”. */
    label: z.string().max(200),
    /** Every folder path, host or app this call touches; a rule must cover all of them. */
    covers: z.array(z.string().max(1024)).max(100),
  })
  .strict();
export type ApprovalScope = z.infer<typeof approvalScopeSchema>;

/** Bound to one call in one run; a response for any other call is rejected. */
export const approvalRequestSchema = z
  .object({
    callId: z.string().uuid(),
    runId: z.string().uuid(),
    capability: z
      .object({
        id: z.string().max(80),
        title: z.string().max(120),
        /** The connected app a tool belongs to (“Gmail”), shown with its logo. */
        app: z.string().max(80).optional(),
      })
      .strict(),
    preview: approvalPreviewSchema,
    scope: approvalScopeSchema.optional(),
  })
  .strict();
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;

export const runStatusSchema = z.enum(['running', 'done', 'stopped', 'error', 'interrupted']);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const activityRunSchema = z
  .object({
    id: z.string().uuid(),
    prompt: z.string().max(8000),
    model: z.string().max(160),
    status: runStatusSchema,
    error: z.string().max(400),
    /** How many screenshots were sent. The images themselves are never stored. */
    screens: z.number().int().min(0).max(8),
    startedAt: z.number().int().nonnegative(),
    finishedAt: z.number().int().nonnegative().nullable(),
    steps: z.array(toolStepSchema).max(50),
  })
  .strict();
export type ActivityRun = z.infer<typeof activityRunSchema>;
export const activitySchema = z.array(activityRunSchema).max(50);
export type Activity = z.infer<typeof activitySchema>;

/** A saved "Always allow", listed and removable in Settings → Privacy. */
export const approvalRuleSchema = z
  .object({
    id: z.string().uuid(),
    capabilityId: z.string().min(1).max(80),
    capabilityTitle: z.string().min(1).max(120),
    kind: approvalScopeSchema.shape.kind,
    value: z.string().max(1024),
    label: z.string().max(200),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();
export type ApprovalRule = z.infer<typeof approvalRuleSchema>;
export const approvalRulesSchema = z.array(approvalRuleSchema).max(500);

const inside = (path: string, folder: string) =>
  path === folder || path.startsWith(folder.endsWith('/') ? folder : `${folder}/`);
const onSite = (host: string, site: string) => host === site || host.endsWith(`.${site}`);

/** Whether a saved rule allows this request: same action, and it covers everything touched. */
export function ruleAllows(rule: ApprovalRule, request: ApprovalRequest) {
  const scope = request.scope;
  if (!scope || rule.capabilityId !== request.capability.id || rule.kind !== scope.kind)
    return false;
  if (rule.kind === 'any') return true;
  if (!scope.covers.length) return false;
  return scope.covers.every(item =>
    rule.kind === 'folder'
      ? inside(item, rule.value)
      : rule.kind === 'site'
        ? onSite(item.toLowerCase(), rule.value.toLowerCase())
        : item === rule.value,
  );
}

/** The "Always allow" button: where it applies, so people know what they are agreeing to. */
export function alwaysAllowLabel(request: ApprovalRequest, compact = false) {
  const scope = request.scope;
  const what = `“${request.capability.title}”`;
  if (!scope) return compact ? 'Always allow in this chat' : `Always allow ${what} in this chat`;
  const where =
    scope.kind === 'folder'
      ? `in ${scope.label}`
      : scope.kind === 'site'
        ? `on ${scope.label}`
        : scope.kind === 'app'
          ? `for ${scope.label}`
          : '';
  if (compact) return where ? `Always allow ${where}` : 'Always allow';
  return where ? `Always allow ${what} ${where}` : `Always allow ${what}`;
}

/** How a saved rule reads in Settings. */
export function describeRule(rule: ApprovalRule) {
  return rule.kind === 'folder'
    ? `In ${rule.label}`
    : rule.kind === 'site'
      ? `On ${rule.label}`
      : rule.kind === 'app'
        ? `For ${rule.label}`
        : 'Anywhere';
}
