import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LocalServer } from '../../packages/contracts/src/index';
import {
  describeServer,
  launcherMissing,
  resolveLauncher,
  serverParameters,
} from '../../apps/desktop/src/main/connectors/local-server';

const notes: LocalServer = {
  runtime: 'node',
  package: 'notes-server',
  version: '1.4.2',
  args: ['--vault', 'Work'],
};

test('a launcher is found by name in the directories given, and missing says what to install', () => {
  const dir = mkdtempSync(join(tmpdir(), 'edi-launcher-'));
  writeFileSync(join(dir, 'npx'), '');
  assert.equal(resolveLauncher('node', [dir]), join(dir, 'npx'));
  // uvx isn't there: the answer is null, and the message names the one thing that fixes it.
  assert.equal(resolveLauncher('python', [dir]), null);
  assert.match(launcherMissing('python'), /uv/);
  assert.match(launcherMissing('node'), /Node\.js/);
});

test('the version is pinned and the package’s own install scripts are refused', () => {
  const node = serverParameters(notes, '/opt/homebrew/bin/npx');
  assert.deepEqual(node.args, [
    '--yes',
    '--ignore-scripts',
    'notes-server@1.4.2',
    '--vault',
    'Work',
  ]);
  assert.equal(node.env.npm_config_ignore_scripts, 'true');

  // uvx pins with `==` and names the command to run from that package.
  const python = serverParameters({ ...notes, runtime: 'python' }, '/opt/homebrew/bin/uvx');
  assert.deepEqual(python.args, [
    '--from',
    'notes-server==1.4.2',
    'notes-server',
    '--vault',
    'Work',
  ]);
});

test('a local server inherits none of the person’s own environment', () => {
  process.env.EDI_TEST_SECRET = 'sk-should-never-be-passed-on';
  try {
    const { env, cwd } = serverParameters(notes, '/opt/homebrew/bin/npx');
    assert.equal(env.EDI_TEST_SECRET, undefined);
    // Only what a launcher genuinely needs, and nothing that carries a key.
    assert.deepEqual(Object.keys(env).sort(), [
      'HOME',
      'PATH',
      'UV_NO_CONFIG',
      'npm_config_ignore_scripts',
      'npm_config_yes',
    ]);
    // The launcher's own directory is reachable; the person's PATH is not copied in.
    assert.match(env.PATH, /^\/opt\/homebrew\/bin:/);
    const ambient = process.env.PATH;
    if (ambient) assert.notEqual(env.PATH, ambient);
    // Never Edi's own folder: a server gets no view of the app's files.
    assert.notEqual(cwd, process.cwd());
  } finally {
    delete process.env.EDI_TEST_SECRET;
  }
});

test('a server describes itself the way it will be run', () => {
  assert.equal(describeServer(notes), 'npx notes-server@1.4.2');
  assert.equal(describeServer({ ...notes, runtime: 'python' }), 'uvx notes-server==1.4.2');
});
