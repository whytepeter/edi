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
const signStamp = join(build, '.edi-host-signing');
const plist = join(host, 'Contents/Info.plist');
// Kept outside build/, which only holds generated files and may be deleted.
const entitlements = join(root, 'signing/entitlements.mac.plist');

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

/** What macOS ties a permission to: the designated requirement, or '' when unsigned or missing. */
function requirement() {
  try {
    const out = execFileSync('codesign', ['-d', '-r-', host], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return out.match(/designated => (.*)/)?.[1]?.trim() ?? '';
  } catch {
    return '';
  }
}

/**
 * macOS keeps a permission for the app's designated requirement. Signed ad hoc, that is the
 * binary's hash, which changes whenever Electron updates: Settings still shows Edi as allowed
 * while macOS refuses the new build. A development certificate's requirement names the bundle
 * id and certificate instead, so grants survive rebuilds. EDI_DEV_SIGN_IDENTITY picks one
 * ('-' for ad hoc); otherwise the first Apple Development or Developer ID identity is used.
 */
function signingIdentity() {
  const chosen = process.env.EDI_DEV_SIGN_IDENTITY?.trim();
  if (chosen) return { id: chosen, name: chosen === '-' ? 'ad hoc' : chosen };
  try {
    const listed = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const match = listed.match(
      /^\s*\d+\)\s+([0-9A-F]{40})\s+"((?:Apple Development|Developer ID Application|Mac Developer):[^"]+)"/m,
    );
    if (match) return { id: match[1], name: match[2] };
  } catch {
    // No keychain access: sign ad hoc.
  }
  return { id: '-', name: 'ad hoc' };
}

mkdirSync(build, { recursive: true });
const before = existsSync(host) ? requirement() : '';
const signing = signingIdentity();
const signedWith = existsSync(signStamp) ? readFileSync(signStamp, 'utf8').trim() : '';
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
if (ready && !cloned && signedWith === signing.id) process.exit(0);

for (const [key, value] of Object.entries(needed)) {
  plutil(['-replace', key, '-string', value, plist]);
}
// No hardened runtime in dev, so entitlements are optional here.
const sign = id =>
  execFileSync(
    'codesign',
    [
      '--force',
      '--sign',
      id,
      ...(existsSync(entitlements) ? ['--entitlements', entitlements] : []),
      host,
    ],
    { stdio: 'inherit' },
  );
let signedAs = signing;
try {
  sign(signing.id);
} catch (error) {
  if (signing.id === '-') throw error;
  // eslint-disable-next-line no-console -- dev setup note in the terminal running `pnpm dev`
  console.warn(`Edi dev host: could not sign with ${signing.name}; signing ad hoc.`);
  signedAs = { id: '-', name: 'ad hoc' };
  sign('-');
}
writeFileSync(signStamp, `${signedAs.id}\n`);

const after = requirement();
if (before && after !== before) {
  // eslint-disable-next-line no-console -- dev setup note in the terminal running `pnpm dev`
  console.warn(
    [
      `Edi dev host re-signed (${signedAs.name}). Permissions granted to the previous build no`,
      'longer apply, though System Settings may still show Edi as allowed. In Privacy & Security,',
      'turn Edi off and on again under Screen Recording and Accessibility (or remove it with −',
      'and let Edi ask).',
      ...(signedAs.id === '-'
        ? ['Signed ad hoc, this happens after every Electron update; see EDI_DEV_SIGN_IDENTITY.']
        : []),
    ].join('\n'),
  );
}
const lsregister =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
try {
  execFileSync(lsregister, ['-f', host], { stdio: 'ignore' });
} catch {
  // Listing still works after a relaunch if registration is delayed.
}
