/* eslint-disable no-console -- a command-line script reports to the terminal */
/**
 * Writes art.svg for the built-in characters from their source in src/. Run after editing them:
 *   pnpm --filter @edi/characters build
 * The output is checked the same way as any installed package.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { checkCharacter } from '@edi/contracts';
import { EdiArt } from '../src/edi';
import { MochiArt } from '../src/mochi';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const characters = { edi: <EdiArt />, mochi: <MochiArt /> };

let failed = false;
for (const [id, element] of Object.entries(characters)) {
  // One part per line keeps diffs readable.
  const markup = renderToStaticMarkup(element).replace(/<g data-part=/g, '\n<g data-part=');
  const art = `<!-- Generated from packages/characters/src/${id}.tsx. Edit that file, then run the build. -->\n${markup}\n`;
  await writeFile(join(root, id, 'art.svg'), art);
  const manifest = await readFile(join(root, id, 'character.json'), 'utf8');
  const { problems } = checkCharacter({ manifest, art }, { builtIn: true });
  for (const problem of problems) console.log(`${id}: ${problem.level}: ${problem.message}`);
  if (problems.some(problem => problem.level === 'error')) failed = true;
  else console.log(`${id}: ok (${(art.length / 1000).toFixed(1)} KB)`);
}
if (failed) process.exitCode = 1;
