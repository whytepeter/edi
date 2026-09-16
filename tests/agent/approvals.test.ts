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

test('“Always allow” in a folder is saved, survives a restart, covers waiting reviews there, and can be removed', async () => {
  const { createRepositories, openDatabase } = await import('../../packages/storage/src/index');
  const { ApprovalRules } = await import('../../apps/desktop/src/main/agent/approval-rules');
  const repositories = createRepositories(openDatabase(':memory:'));
  const rules = new ApprovalRules(repositories, () => 100);
  const inFolder = (n: number, covers: string[], runId?: string) => ({
    ...request(n, 'files.move', runId),
    scope: { kind: 'folder' as const, value: '/Users/ada/Desktop', label: '~/Desktop', covers },
  });
  const queue = new ApprovalQueue(
    () => {},
    pending => rules.allows(pending),
  );
  const first = queue.request(inFolder(1, ['/Users/ada/Desktop/a.png']), live());
  const sameFolderOtherRun = queue.request(
    inFolder(2, ['/Users/ada/Desktop/b.png'], '00000000-0000-4000-8000-0000000000bb'),
    live(),
  );
  const outside = queue.request(inFolder(3, ['/Users/ada/Documents/c.png']), live());

  const rule = rules.save(inFolder(1, ['/Users/ada/Desktop/a.png']))!;
  const { ruleAllows } = await import('../../packages/contracts/src/index');
  queue.respond(inFolder(1, []).callId, 'approved', pending => ruleAllows(rule, pending));
  assert.equal(await first, 'approved');
  assert.equal(await sameFolderOtherRun, 'approved');
  assert.equal(queue.current?.callId, inFolder(3, []).callId);
  queue.respond(inFolder(3, []).callId, 'denied');
  assert.equal(await outside, 'denied');

  // A new session reads the saved rule; an action without a scope is never saved.
  const later = new ApprovalRules(repositories);
  assert.equal(later.allows(inFolder(4, ['/Users/ada/Desktop/Shots/d.png'])), true);
  assert.equal(later.save(request(5, 'notes.delete')), null);
  later.remove(rule.id);
  assert.equal(later.allows(inFolder(6, ['/Users/ada/Desktop/e.png'])), false);
  assert.deepEqual(repositories.approvalRules.list(), []);
});
