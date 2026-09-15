#!/usr/bin/env node
/**
 * Edi for other Macs: signed with a Developer ID certificate, hardened runtime on, notarized by
 * Apple and stapled, as a .dmg and a .zip in release/. `--check` only confirms the certificate
 * and notarization credentials are in place, before the slow native builds run.
 *
 * Needs (docs/RELEASE.md):
 * - A "Developer ID Application" certificate in the login keychain. On CI, CSC_LINK and
 *   CSC_KEY_PASSWORD import it, and CSC_NAME names it.
 * - Notarization credentials in the environment, one of:
 *   APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER (recommended),
 *   APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID, or
 *   APPLE_KEYCHAIN + APPLE_KEYCHAIN_PROFILE.
 * Only whether these are set is checked here; their values go straight to Apple's tools.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* eslint-disable no-console -- a release script reports in the terminal running it */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
const PREFIX = 'Developer ID Application: ';

function fail(message) {
  console.error(`\nrelease: ${message}\n`);
  process.exit(1);
}

if (process.platform !== 'darwin') fail('build releases on a Mac.');

/** The certificate name without its prefix, which electron-builder refuses. */
function identity() {
  const named = process.env.CSC_NAME?.trim();
  if (named) return named.startsWith(PREFIX) ? named.slice(PREFIX.length) : named;
  const listed = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
    encoding: 'utf8',
  });
  const found = listed.match(/"Developer ID Application: ([^"]+)"/)?.[1];
  if (found) return found;
  const development = /"Apple Development: /.test(listed);
  return fail(
    'no "Developer ID Application" certificate in the keychain.' +
      (development
        ? ' "Apple Development" certificates only run on your own Macs; Apple will not notarize them.'
        : '') +
      ' Create one at developer.apple.com → Certificates (needs the Apple Developer Program),' +
      ' open it to add it to Keychain, then run this again. See docs/RELEASE.md.',
  );
}

const credentialSets = [
  ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'],
  ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'],
  ['APPLE_KEYCHAIN', 'APPLE_KEYCHAIN_PROFILE'],
];
const credentials = credentialSets.find(names => names.every(name => process.env[name]?.trim()));

const signer = identity();
if (!credentials)
  fail(
    'no notarization credentials. Set one of these groups in your shell:\n  ' +
      credentialSets.map(names => names.join(' + ')).join('\n  ') +
      '\nThe App Store Connect API key (first group) is recommended. See docs/RELEASE.md.',
  );
if (credentials[0] === 'APPLE_API_KEY' && !existsSync(process.env.APPLE_API_KEY))
  fail('APPLE_API_KEY must be the path to the .p8 key file from App Store Connect.');

console.log(
  `release: signing as "${PREFIX}${signer}", notarizing with ${credentials.join(' + ')}.`,
);
if (process.argv.includes('--check')) process.exit(0);

const { build, Platform, Arch } = require('electron-builder');
// Merged over package.json's "build": same files and resources, now signed and notarized.
await build({
  projectDir: root,
  targets: Platform.MAC.createTarget(['dmg', 'zip'], Arch.arm64),
  config: {
    electronDist: 'node_modules/electron/dist',
    mac: { identity: signer, hardenedRuntime: true, notarize: true },
  },
});

// What a downloaded copy meets: a valid signature, Gatekeeper's verdict, and the stapled ticket.
const app = join(root, 'release/mac-arm64/Edi.app');
for (const [tool, ...args] of [
  ['codesign', '--verify', '--deep', '--strict', '--verbose=2', app],
  ['spctl', '--assess', '--type', 'execute', '--verbose=2', app],
  ['xcrun', 'stapler', 'validate', app],
])
  execFileSync(tool, args, { stdio: 'inherit' });
console.log('\nrelease: signed, notarized and stapled. The .dmg and .zip are in release/.');
