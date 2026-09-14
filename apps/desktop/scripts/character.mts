/* eslint-disable no-console -- a command-line tool reports to the terminal */
/**
 * Tools for character creators.
 *
 *   pnpm character check <folder or file.edichar>   run the same check Edi runs before installing
 *   pnpm character pack <folder> [out.edichar]      check, then zip character.json and art.svg
 *
 * A folder holds character.json and art.svg. See docs/characters/README.md.
 */
import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { checkCharacter } from '@edi/contracts';
import {
  readCharacterPackage,
  writeCharacterPackage,
  type PackageFiles,
} from '../src/main/characters/package-file';

async function load(target: string): Promise<PackageFiles> {
  const info = await stat(target);
  if (info.isDirectory())
    return {
      manifest: await readFile(join(target, 'character.json'), 'utf8'),
      art: await readFile(join(target, 'art.svg'), 'utf8'),
    };
  return readCharacterPackage(await readFile(target));
}

function report(files: PackageFiles) {
  const { descriptor, problems } = checkCharacter(files);
  for (const problem of problems)
    console.log(`${problem.level === 'error' ? '✗ error  ' : '! warning'}  ${problem.message}`);
  if (!descriptor) {
    console.log('\nNot ready: fix the errors above.');
    return false;
  }
  const { manifest, variants } = descriptor;
  console.log(`✓ ${manifest.name} ${manifest.version} (${manifest.id}) passes the check.`);
  for (const [part, names] of Object.entries(variants))
    console.log(`  ${part.padEnd(7)} ${names.join(', ') || '(no variants)'}`);
  return true;
}

const [command, target, output] = process.argv.slice(2);
if (!target || (command !== 'check' && command !== 'pack')) {
  console.log(
    'Usage:\n  pnpm character check <folder or .edichar>\n  pnpm character pack <folder> [out.edichar]',
  );
  process.exit(2);
}
try {
  const files = await load(resolve(target));
  const ok = report(files);
  if (command === 'pack' && ok) {
    const manifest = JSON.parse(files.manifest) as { id: string };
    const destination = resolve(output ?? `${manifest.id}.edichar`);
    await writeFile(destination, writeCharacterPackage(files));
    console.log(`\nPacked ${basename(destination)}. Drop it on Edi’s Appearance page to try it.`);
  }
  process.exitCode = ok ? 0 : 1;
} catch (error) {
  console.log(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
