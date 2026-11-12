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
    /**
     * Actions the person already allowed skip review. It may take a moment to decide (a
     * background task's action is checked against its instructions first).
     */
    private readonly preapproved: (request: ApprovalRequest) => boolean | Promise<boolean> = () =>
      false,
  ) {}

  get current(): ApprovalRequest | null {
    return this.entries[0]?.request ?? null;
  }

  /** Every run with a review waiting, shown or still in line behind the one that is. */
  get waitingRuns(): ReadonlySet<string> {
    return new Set(this.entries.map(entry => entry.request.runId));
  }

  async request(request: ApprovalRequest, signal: AbortSignal): Promise<Decision> {
    if (signal.aborted) throw aborted();
    const allowed = this.preapproved(request);
    if (allowed === true || (allowed !== false && (await allowed))) return 'approved';
    // Stopped while it was being checked.
    if (signal.aborted) throw aborted();
    return new Promise((resolve, reject) => {
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
      // Told for every arrival, not only the first: a run in line is waiting on the person too.
      this.onChange(this.current);
    });
  }

  /**
   * `alsoQueued` approves waiting reviews too: `true` for the same kind in the same run, or a
   * test for each waiting review (a saved rule that covers it).
   */
  respond(
    callId: string,
    decision: Decision,
    alsoQueued: boolean | ((request: ApprovalRequest) => boolean) = false,
  ) {
    const head = this.entries[0];
    if (!head || head.request.callId !== callId)
      throw new Error('That approval is no longer pending.');
    this.entries.shift();
    head.settle(decision);
    if (alsoQueued && decision === 'approved') {
      const same = this.entries.filter(entry =>
        typeof alsoQueued === 'function'
          ? alsoQueued(entry.request)
          : entry.request.runId === head.request.runId &&
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
    this.onChange(this.current);
  }
}
