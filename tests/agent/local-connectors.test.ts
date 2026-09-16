import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepositories, openDatabase } from '../../packages/storage/src/index';
import { ConnectorManager } from '../../apps/desktop/src/main/connectors/manager';
import { MemorySecretStore } from '../../apps/desktop/src/main/connectors/secrets';
import type { Connector, LocalServer } from '../../packages/contracts/src/index';

const fixture = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/stdio-mcp-server.mjs');

const notes: LocalServer = {
  runtime: 'node',
  package: 'notes-server',
  version: '1.4.2',
  args: [],
};

const context = {
  callId: '00000000-0000-4000-8000-000000000001',
  runId: '00000000-0000-4000-8000-000000000002',
};
const live = () => new AbortController().signal;

/**
 * A manager that runs the fixture server instead of fetching a package. `env` drives the
 * fixture's awkward paths: stopping on its own, or failing before it says anything.
 */
function manager(env: Record<string, string> = {}) {
  const repositories = createRepositories(openDatabase(':memory:'));
  const connectors = new ConnectorManager({
    repositories,
    secrets: new MemorySecretStore(),
    openBrowser: async () => {},
    restartMs: 20,
    // Long enough that a server dying moments after connecting is never called stable, which
    // is what makes the limit reachable; the real wait is a minute.
    stableMs: 5_000,
    startWith: () => ({
      command: process.execPath,
      args: [fixture],
      env: { PATH: '/usr/bin:/bin', HOME: process.env.HOME ?? '', ...env },
      stderr: 'pipe' as const,
    }),
  });
  const settled = (predicate: (list: Connector[]) => boolean) =>
    new Promise<Connector[]>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out')), 8_000);
      const check = (list: Connector[]) => {
        if (!predicate(list)) return;
        clearTimeout(timer);
        stop();
        resolve(list);
      };
      const stop = connectors.onChange(check);
      check(connectors.list());
    });
  return { repositories, connectors, settled };
}

test('a server that runs on this Mac lists its tools and answers, with no sign-in', async () => {
  const { connectors, settled } = manager();
  try {
    connectors.add({ local: notes, name: 'Team Notes' });
    const [connector] = await settled(list => list[0]?.status === 'connected');
    assert.equal(connector!.provider, 'local');
    assert.deepEqual(connector!.local, notes);
    // Nothing to sign in to, so no browser was ever opened and no secret was written.
    assert.deepEqual(
      connector!.tools.map(tool => [tool.name, tool.readOnly]),
      [
        ['search_pages', true],
        ['delete-page', false],
      ],
    );

    const search = connectors.capabilities().find(tool => tool.id.endsWith('search_pages'));
    const prepared = search!.prepare({ query: 'packing' }, context);
    const result = await prepared.execute(live());
    const output = result.output as { text: string; note: string };
    assert.match(output.text, /Packing list/);
    // A result is information from a server, never an instruction to follow.
    assert.match(output.note, /not instructions/);
  } finally {
    await connectors.dispose();
  }
});

test('a server that stops on its own is started again', async () => {
  // Stops shortly after connecting, once; the restart then runs a server that stays up.
  const { connectors, settled } = manager({ EDI_TEST_EXIT_AFTER_MS: '120' });
  try {
    connectors.add({ local: notes, name: 'Flaky Notes' });
    await settled(list => list[0]?.status === 'connected');
    // It stops, and Edi says so rather than going quiet.
    await settled(list => /stopped/i.test(list[0]?.error ?? ''));
    // And it comes back by itself.
    await settled(list => list[0]?.status === 'connected');
  } finally {
    await connectors.dispose();
  }
});

test('a server that keeps stopping is left alone instead of being started forever', async () => {
  // Long enough to connect each time, so this is a server that crashes rather than one that
  // never starts: those are different faults with different answers.
  const { connectors, settled } = manager({ EDI_TEST_EXIT_AFTER_MS: '200' });
  try {
    connectors.add({ local: notes, name: 'Broken Notes' });
    const [connector] = await settled(list => /keeps stopping/i.test(list[0]?.error ?? ''));
    assert.equal(connector!.status, 'error');
    // Nothing is running, so it offers no tools.
    assert.deepEqual(connectors.capabilities(), []);
  } finally {
    await connectors.dispose();
  }
});

test('a server that cannot start repeats back what it said', async () => {
  const { connectors, settled } = manager({ EDI_TEST_FAIL_TO_START: '1' });
  try {
    connectors.add({ local: notes, name: 'Missing Notes' });
    const [connector] = await settled(list => list[0]?.status === 'error');
    assert.match(connector!.error, /cannot find module/i);
  } finally {
    await connectors.dispose();
  }
});

test('removing a local server stops it and leaves nothing waiting to start again', async () => {
  const { connectors, repositories, settled } = manager({ EDI_TEST_EXIT_AFTER_MS: '60' });
  try {
    const id = connectors.add({ local: notes, name: 'Team Notes' });
    await settled(list => list[0]?.status === 'connected');
    await connectors.remove(id);
    assert.deepEqual(repositories.connectors.list(), []);
    assert.deepEqual(connectors.capabilities(), []);
    // A restart was very likely pending; after removal nothing may come back.
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.deepEqual(connectors.list(), []);
  } finally {
    await connectors.dispose();
  }
});
