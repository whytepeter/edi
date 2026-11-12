/* eslint-disable no-console -- a command-line report printed to the terminal */
/**
 * Where spoken replies spend their wait: median and 90th percentile per stage, from the timings
 * Edi keeps of each spoken turn (numbers only). The headline is "first sound": how long after
 * the person stops talking they hear Edi.
 *
 *   pnpm voice:report [path] [--last 100]
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = args.indexOf('--last');
const last = flag >= 0 ? Number(args[flag + 1]) : 200;
const path =
  args.find((arg, index) => !arg.startsWith('--') && (flag < 0 || index !== flag + 1)) ??
  join(homedir(), 'Library/Application Support/Edi/voice-timings.jsonl');

if (!existsSync(path)) {
  console.error(`No voice timings at ${path} yet. Talk to Edi, then run this again.`);
  process.exit(1);
}

const records = readFileSync(path, 'utf8')
  .split('\n')
  .flatMap(line => {
    try {
      return line.trim() ? [JSON.parse(line)] : [];
    } catch {
      return [];
    }
  })
  .slice(-last);
const answered = records.filter(record => record.outcome === 'answered');
const stages = [
  ['transcript', 'words recognized'],
  ['sifted', 'room noise taken out'],
  ['screens', 'screens captured'],
  ['started', 'model called'],
  ['firstWords', 'first words written'],
  ['toVoice', 'first words to the voice'],
  ['firstSound', 'FIRST SOUND'],
  ['finished', 'reply finished'],
];
const at = (sorted, share) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))];

console.log(`${records.length} spoken turns, ${answered.length} answered (${path})\n`);
console.log('stage'.padEnd(28), 'median'.padStart(9), 'p90'.padStart(9), 'turns'.padStart(7));
for (const [key, label] of stages) {
  const values = answered
    .flatMap(record => (typeof record[key] === 'number' ? [record[key]] : []))
    .sort((a, b) => a - b);
  if (!values.length) continue;
  console.log(
    label.padEnd(28),
    `${Math.round(at(values, 0.5))} ms`.padStart(9),
    `${Math.round(at(values, 0.9))} ms`.padStart(9),
    String(values.length).padStart(7),
  );
}

const byModel = new Map();
for (const record of answered) {
  if (typeof record.firstSound !== 'number') continue;
  const key = `${record.model} (reasoning ${record.reasoning})`;
  byModel.set(key, [...(byModel.get(key) ?? []), record.firstSound]);
}
if (byModel.size) console.log('\nfirst sound by model');
for (const [key, values] of byModel) {
  values.sort((a, b) => a - b);
  console.log(`  ${key}: median ${Math.round(at(values, 0.5))} ms over ${values.length} turns`);
}
