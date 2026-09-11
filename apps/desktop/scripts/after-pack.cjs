const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

/** Unsigned packages still need an ad-hoc signature so macOS will register the microphone. */
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  execFileSync(
    'codesign',
    [
      '--force',
      '--sign',
      '-',
      '--entitlements',
      join(__dirname, '../build/entitlements.mac.plist'),
      join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`),
    ],
    { stdio: 'inherit' },
  );
};
