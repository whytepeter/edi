import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Dev host is Edi.app. Stock Electron.app stays untouched so macOS does not ask as Cursor or Electron. */
const usage = 'Edi listens while you hold it down, so it can answer what you ask out loud.';
const screenUsage = 'Edi looks at your screen when you ask, so it can answer what you see.';
const remindersUsage = 'Edi checks and adds reminders when you ask.';
const calendarUsage = 'Edi checks your schedule and adds events when you ask.';
const bundleId = 'com.fewerlabs.edi.dev';

if (process.platform !== 'darwin') process.exit(0);

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fromPackage = createRequire(join(root, 'package.json'));
const electronPath = fromPackage('electron');
const electronVersion = fromPackage('electron/package.json').version;
const stock = join(dirname(electronPath), '../..');
const build = join(root, 'build');
const host = join(build, 'Edi.app');
const stamp = join(build, '.edi-host-version');
const plist = join(host, 'Contents/Info.plist');
const entitlements = join(root, 'build/entitlements.mac.plist');

function plutil(args) {
  return execFileSync('plutil', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function current(key) {
  try {
    return plutil(['-extract', key, 'raw', '-expect', 'string', plist]);
  } catch {
    return '';
  }
}

mkdirSync(build, { recursive: true });
const stamped = existsSync(stamp) ? readFileSync(stamp, 'utf8').trim() : '';
let cloned = false;
if (!existsSync(host) || stamped !== electronVersion) {
  rmSync(host, { recursive: true, force: true });
  try {
    execFileSync('cp', ['-cR', stock, host], { stdio: 'pipe' });
  } catch {
    execFileSync('cp', ['-R', stock, host], { stdio: 'pipe' });
  }
  writeFileSync(stamp, `${electronVersion}\n`);
  cloned = true;
}

const needed = {
  NSMicrophoneUsageDescription: usage,
  NSScreenCaptureUsageDescription: screenUsage,
  // Without these, macOS ends the app when EventKit asks for access.
  NSRemindersFullAccessUsageDescription: remindersUsage,
  NSRemindersUsageDescription: remindersUsage,
  NSCalendarsFullAccessUsageDescription: calendarUsage,
  NSCalendarsUsageDescription: calendarUsage,
  CFBundleIdentifier: bundleId,
  CFBundleName: 'Edi',
  CFBundleDisplayName: 'Edi',
};

const ready = Object.entries(needed).every(([key, value]) => current(key) === value);
if (ready && !cloned) process.exit(0);

for (const [key, value] of Object.entries(needed)) {
  plutil(['-replace', key, '-string', value, plist]);
}
// The dev host is signed ad hoc without the hardened runtime, so entitlements are optional here.
execFileSync(
  'codesign',
  [
    '--force',
    '--sign',
    '-',
    ...(existsSync(entitlements) ? ['--entitlements', entitlements] : []),
    host,
  ],
  { stdio: 'inherit' },
);
const lsregister =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
try {
  execFileSync(lsregister, ['-f', host], { stdio: 'ignore' });
} catch {
  // Listing still works after a relaunch if registration is delayed.
}
