import { randomUUID } from 'node:crypto';
import { ruleAllows, type ApprovalRequest, type ApprovalRule } from '@edi/contracts';
import type { Repositories } from '@edi/storage';

/**
 * Saved "Always allow" choices, shared by conversations and background tasks. A rule is saved
 * only for an action that says where it applies (a folder, a site, an app, or any for adding
 * reminders and events); other actions can be allowed for one conversation or task only.
 */
export class ApprovalRules {
  private rules: ApprovalRule[];
  private readonly listeners = new Set<(rules: ApprovalRule[]) => void>();

  constructor(
    private readonly repositories: Pick<Repositories, 'approvalRules'>,
    private readonly now: () => number = Date.now,
  ) {
    this.rules = repositories.approvalRules.list();
  }

  list() {
    return this.rules;
  }

  onChange(listener: (rules: ApprovalRule[]) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  allows(request: ApprovalRequest) {
    return this.rules.some(rule => ruleAllows(rule, request));
  }

  /** Saves a rule for this request's scope; returns it, or null when the action has no scope. */
  save(request: ApprovalRequest): ApprovalRule | null {
    const scope = request.scope;
    if (!scope) return null;
    const rule: ApprovalRule = {
      id: randomUUID(),
      capabilityId: request.capability.id,
      capabilityTitle: request.capability.title,
      kind: scope.kind,
      value: scope.kind === 'any' ? '' : scope.value,
      label: scope.label,
      createdAt: this.now(),
    };
    this.repositories.approvalRules.add(rule);
    this.refresh();
    return rule;
  }

  remove(id: string) {
    if (!this.repositories.approvalRules.remove(id)) throw new Error('That rule no longer exists.');
    this.refresh();
  }

  private refresh() {
    this.rules = this.repositories.approvalRules.list();
    for (const listener of this.listeners) listener(this.rules);
  }
}
