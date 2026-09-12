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

  constructor(private readonly onChange: (head: ApprovalRequest | null) => void) {}

  get current(): ApprovalRequest | null {
    return this.entries[0]?.request ?? null;
  }

  request(request: ApprovalRequest, signal: AbortSignal): Promise<Decision> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(aborted());
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

  respond(callId: string, decision: Decision) {
    const head = this.entries[0];
    if (!head || head.request.callId !== callId)
      throw new Error('That approval is no longer pending.');
    this.entries.shift();
    head.settle(decision);
    this.onChange(this.current);
  }

  private remove(entry: Entry) {
    const index = this.entries.indexOf(entry);
    if (index === -1) return;
    this.entries.splice(index, 1);
    if (index === 0) this.onChange(this.current);
  }
}
