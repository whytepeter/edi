import type { ApprovalGate } from '@edi/capabilities';
import type { ApprovalRequest } from '@edi/contracts';

type Decision = 'approved' | 'denied';
interface Entry {
  request: ApprovalRequest;
  settle(decision: Decision): void;
}

const aborted = () => new DOMException('Approval cancelled', 'AbortError');

/**
 * Pending reviews, first in first out. Only the head is shown, and a response is
 * accepted only for the head's call ID, so a stale or forged decision cannot land
 * on a different action.
 */
export class ApprovalQueue implements ApprovalGate {
  private readonly entries: Entry[] = [];

  constructor(
    private readonly onChange: (head: ApprovalRequest | null) => void,
    /** Actions the person already allowed for this conversation skip review. */
    private readonly preapproved: (request: ApprovalRequest) => boolean = () => false,
  ) {}

  get current(): ApprovalRequest | null {
    return this.entries[0]?.request ?? null;
  }

  request(request: ApprovalRequest, signal: AbortSignal): Promise<Decision> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(aborted());
      if (this.preapproved(request)) return resolve('approved');
      const onAbort = () => {
        this.remove(entry);
        reject(aborted());
      };
      const entry: Entry = {
        request,
        settle: decision => {
          signal.removeEventListener('abort', onAbort);
          resolve(decision);
        },
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.entries.push(entry);
      if (this.entries.length === 1) this.onChange(request);
    });
  }

  /** `alsoQueued` approves waiting reviews of the same kind in the same run too. */
  respond(callId: string, decision: Decision, alsoQueued = false) {
    const head = this.entries[0];
    if (!head || head.request.callId !== callId)
      throw new Error('That approval is no longer pending.');
    this.entries.shift();
    head.settle(decision);
    if (alsoQueued && decision === 'approved') {
      const same = this.entries.filter(
        entry =>
          entry.request.runId === head.request.runId &&
          entry.request.capability.id === head.request.capability.id,
      );
      for (const entry of same) {
        this.entries.splice(this.entries.indexOf(entry), 1);
        entry.settle('approved');
      }
    }
    this.onChange(this.current);
  }

  private remove(entry: Entry) {
    const index = this.entries.indexOf(entry);
    if (index === -1) return;
    this.entries.splice(index, 1);
    if (index === 0) this.onChange(this.current);
  }
}
