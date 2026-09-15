#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Launch the Edi.app host through LaunchServices so macOS asks for Edi, not Cursor. */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ediApp = join(root, 'build', 'Edi.app');

if (!existsSync(ediApp)) {
  console.error('Edi.app is missing. Run pnpm dev so prepare-electron can create it.');
  process.exit(1);
}

const envArgs = [];
for (const [name, value] of Object.entries(process.env)) {
  if (!value) continue;
  if (name === 'ELECTRON_EXEC_PATH') continue;
  if (
    name.startsWith('ELECTRON') ||
    name.startsWith('EDI') ||
    name.startsWith('VITE') ||
    name === 'NODE_ENV' ||
    name === 'NODE_ENV_ELECTRON_VITE'
  ) {
    envArgs.push('--env', `${name}=${value}`);
  }
}
envArgs.push('--env', `EDI_CWD=${process.cwd()}`);

// LaunchServices drops the app's output; point it back at this terminal so main-process lines
// (like the voice timings) show where `pnpm dev` runs.
const terminal = spawnSync('tty', { stdio: ['inherit', 'pipe', 'ignore'], encoding: 'utf8' });
const tty = terminal.status === 0 ? terminal.stdout.trim() : '';
const output = tty ? ['--stdout', tty, '--stderr', tty] : [];

const forwarded = process.argv.slice(2).map(arg => (arg === '.' ? process.cwd() : arg));
const child = spawn(
  '/usr/bin/open',
  ['-n', '-W', ...output, ediApp, ...envArgs, '--args', ...forwarded],
  { stdio: 'inherit' },
);

const quit = () => {
  spawn('osascript', ['-e', 'tell application "Edi" to quit'], { stdio: 'ignore' });
  child.kill();
};
process.on('SIGTERM', quit);
process.on('SIGINT', quit);
child.on('exit', code => process.exit(code ?? 0));
