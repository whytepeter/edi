import test from 'node:test';
import assert from 'node:assert/strict';
import { ApprovalQueue } from '../../apps/desktop/src/main/agent/approvals';
import type { ApprovalRequest } from '../../packages/contracts/src/index';

const request = (n: number, capability: string, runId = '00000000-0000-4000-8000-0000000000aa') =>
  ({
    callId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    runId,
    capability: { id: capability, title: capability },
    preview: { title: 'Move', action: 'Move', summary: 'Move it.', fields: [] },
  }) satisfies ApprovalRequest;
const live = () => new AbortController().signal;

test('allowing a kind of action also approves waiting ones of that kind in the same run', async () => {
  const heads: (string | null)[] = [];
  const queue = new ApprovalQueue(head => heads.push(head?.callId ?? null));
  const first = queue.request(request(1, 'files.move'), live());
  const second = queue.request(request(2, 'files.move'), live());
  const other = queue.request(request(3, 'files.trash'), live());
  const elsewhere = queue.request(
    request(4, 'files.move', '00000000-0000-4000-8000-0000000000bb'),
    live(),
  );
  queue.respond(request(1, 'files.move').callId, 'approved', true);
  assert.equal(await first, 'approved');
  assert.equal(await second, 'approved');
  // A different kind of action, and the same kind in another run, still wait for review.
  assert.equal(queue.current?.callId, request(3, 'files.trash').callId);
  queue.respond(request(3, 'files.trash').callId, 'denied');
  assert.equal(await other, 'denied');
  assert.equal(queue.current?.callId, request(4, 'files.move').callId);
  queue.respond(request(4, 'files.move').callId, 'approved');
  assert.equal(await elsewhere, 'approved');
  assert.equal(queue.current, null);
});

test('actions already allowed skip review; stale responses are refused', async () => {
  const allowed = new Set(['files.move']);
  const queue = new ApprovalQueue(
    () => {},
    pending => allowed.has(pending.capability.id),
  );
  assert.equal(await queue.request(request(1, 'files.move'), live()), 'approved');
  assert.equal(queue.current, null);
  const waiting = queue.request(request(2, 'files.trash'), live());
  assert.throws(
    () => queue.respond(request(9, 'files.trash').callId, 'approved'),
    /no longer pending/,
  );
  queue.respond(request(2, 'files.trash').callId, 'approved');
  assert.equal(await waiting, 'approved');
});
