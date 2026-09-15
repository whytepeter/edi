const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

/**
 * Unsigned packages still need an ad-hoc signature so macOS will register the microphone. A
 * release (scripts/release.mjs) names a Developer ID identity; electron-builder signs that one.
 */
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (context.packager.platformSpecificBuildOptions.identity) return;
  execFileSync(
    'codesign',
    [
      '--force',
      '--sign',
      '-',
      '--entitlements',
      join(__dirname, '../signing/entitlements.mac.plist'),
      join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`),
    ],
    { stdio: 'inherit' },
  );
};
