import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import type { LocalServer, LocalServerRuntime } from '@edi/contracts';

/**
 * A server that runs on this Mac is code running with the person's own privileges, so Edi
 * starts only a published package through a declared runtime's launcher. There is deliberately
 * no way to give a command line: that would be a way to run anything, which is the one thing a
 * connected app must never be.
 */
const launchers: Record<LocalServerRuntime, string> = { node: 'npx', python: 'uvx' };

/**
 * Where a launcher is normally installed. PATH is consulted first, but Edi cannot rely on it:
 * an app opened from Finder inherits a bare PATH, while npx and uvx live in per-user places
 * like ~/.local/bin and /opt/homebrew/bin.
 */
function searchDirs() {
  return [
    ...(process.env.PATH ?? '').split(delimiter).filter(Boolean),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(homedir(), '.local/bin'),
  ];
}

/** The launcher's full path, or null when this Mac hasn't got it. */
export function resolveLauncher(runtime: LocalServerRuntime, dirs = searchDirs()): string | null {
  const name = launchers[runtime];
  for (const dir of dirs) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Said when the launcher is missing, naming the one thing that fixes it. */
export function launcherMissing(runtime: LocalServerRuntime) {
  return runtime === 'node'
    ? 'Edi needs npx to run this server. Install Node.js, then try again.'
    : 'Edi needs uvx to run this server. Install uv, then try again.';
}

/** How it will be run. Shared with Connectors, so a row and an error never disagree. */
export { describeLocalServer as describeServer } from '@edi/contracts';

/** A single message larger than this ends the connection instead of growing in memory. */
const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;

/**
 * Exactly what Edi runs for a local server. Three things here are decisions, not defaults:
 *
 *  - **The version is pinned.** The package is always fetched as `name@1.4.2`, so the code that
 *    runs is the code that was reviewed, not whatever the registry has moved to since.
 *  - **Install hooks are refused.** A package's own lifecycle scripts run before any tool is
 *    ever listed, so they are arbitrary code that no permission prompt would ever describe.
 *  - **The environment is built from nothing.** The transport would otherwise inherit a set of
 *    the person's own variables; a third-party server has no business seeing them.
 */
export function serverParameters(local: LocalServer, command: string) {
  const args =
    local.runtime === 'node'
      ? ['--yes', '--ignore-scripts', `${local.package}@${local.version}`, ...local.args]
      : ['--from', `${local.package}==${local.version}`, local.package, ...local.args];
  return {
    command,
    args,
    env: {
      // Predictable and small: the launcher's own directory, then the system ones.
      PATH: [dirname(command), '/usr/bin', '/bin'].join(delimiter),
      // Downloads and caches need somewhere to live. Nothing else is passed through.
      HOME: homedir(),
      npm_config_ignore_scripts: 'true',
      npm_config_yes: 'true',
      UV_NO_CONFIG: '1',
    },
    // Kept, so a server that fails to start can say why instead of dying silently.
    stderr: 'pipe' as const,
    // Never the app's own directory: a server gets no view of Edi's files.
    cwd: tmpdir(),
    maxBufferSize: MAX_MESSAGE_BYTES,
  };
}
