import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The Shortcuts command line tool, on macOS 12 and later. */
const SHORTCUTS = '/usr/bin/shortcuts';
const LIST_TIMEOUT_MS = 8_000;
const RUN_TIMEOUT_MS = 90_000;
/** A shortcut's result is read back into the reply, so it stays small. */
const MAX_OUTPUT = 4_000;
const MAX_SHORTCUTS = 200;

function run(args: string[], timeout: number, signal?: AbortSignal) {
  return new Promise<string>((resolve, reject) =>
    execFile(
      SHORTCUTS,
      args,
      { timeout, maxBuffer: 1024 * 1024, ...(signal ? { signal } : {}) },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout);
        const said = String(stderr || error.message)
          .split('\n')
          .map(line => line.trim())
          .find(Boolean);
        reject(new Error(said || 'The Shortcuts app didn’t answer.'));
      },
    ),
  );
}

/** The person's own shortcuts, by name; empty when Shortcuts isn't available. */
export async function listShortcuts(): Promise<string[]> {
  if (process.platform !== 'darwin') return [];
  const listed = await run(['list'], LIST_TIMEOUT_MS).catch(() => '');
  return listed
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, MAX_SHORTCUTS);
}

/**
 * Run one shortcut and return what it gives back. Input and output go through files in a private
 * temporary folder, which is removed either way, so nothing is left behind.
 */
export async function runShortcut(
  name: string,
  input: string | undefined,
  signal: AbortSignal,
): Promise<string> {
  if (process.platform !== 'darwin') throw new Error('Shortcuts only run on macOS.');
  const folder = await mkdtemp(join(tmpdir(), 'edi-shortcut-'));
  const outputPath = join(folder, 'output');
  try {
    const args = ['run', name, '--output-path', outputPath];
    if (input) {
      const inputPath = join(folder, 'input.txt');
      await writeFile(inputPath, input, { mode: 0o600 });
      args.push('--input-path', inputPath);
    }
    await run(args, RUN_TIMEOUT_MS, signal);
    const result = await readFile(outputPath, 'utf8').catch(() => '');
    return result.slice(0, MAX_OUTPUT);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
