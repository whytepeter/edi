/* eslint-disable no-console -- a command-line report printed to the terminal */
/**
 * Summarizes Jev shadow mode (apps/desktop/src/main/jev/shadow.ts): where Jev and Edi's own
 * checks disagree, what following Jev would have saved or cost, and how long Jev took.
 *
 *   pnpm jev:report [path] [--finished-at 0.8]
 *
 * `--finished-at` is how sure Jev must be that a pause ends the turn before it would answer early.
 * The path defaults to the development log; Edi prints the exact path when shadow mode starts.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = args.indexOf('--finished-at');
const finishedAt = flag >= 0 ? Number(args[flag + 1]) : 0.8;
const path =
  args.find((arg, index) => !arg.startsWith('--') && (flag < 0 || index !== flag + 1)) ??
  join(homedir(), 'Library/Application Support/Edi/jev-shadow.jsonl');

if (!(finishedAt > 0 && finishedAt <= 1)) {
  console.error('--finished-at takes a number above 0 and up to 1.');
  process.exit(1);
}
if (!existsSync(path)) {
  console.error(`No shadow log at ${path}. Pass the path Edi printed when shadow mode started.`);
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
  });

const answered = list => list.filter(record => record.jev?.ok);
const percent = (part, whole) => (whole ? `${Math.round((100 * part) / whole)}%` : '–');
const short = text => (text.length > 90 ? `${text.slice(0, 89)}…` : text);
const quantile = (values, q) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0;
};
const show = (title, list, line) => {
  console.log(`  ${title}: ${list.length}`);
  for (const record of list.slice(0, 15)) console.log(`    ${line(record)}`);
  if (list.length > 15) console.log(`    … and ${list.length - 15} more`);
};

function latency(list) {
  const ms = answered(list).map(record => record.jev.ms);
  const errors = new Map();
  for (const record of list) {
    const reason = record.jev === 'skipped' ? 'skipped' : record.jev?.ok ? null : record.jev?.error;
    if (reason) errors.set(reason, (errors.get(reason) ?? 0) + 1);
  }
  const failed = [...errors].map(([reason, count]) => `${reason} ×${count}`).join(', ');
  console.log(
    `  Jev took ${Math.round(quantile(ms, 0.5))} ms median, ${Math.round(quantile(ms, 0.95))} ms p95` +
      (failed ? `; no answer: ${failed}` : ''),
  );
}

const screens = records.filter(record => record.kind === 'screen');
const turns = records.filter(record => record.kind === 'turn');
console.log(`${path}\n${records.length} checks: ${screens.length} screen, ${turns.length} turn\n`);

if (screens.length) {
  const judged = answered(screens);
  const wantsScreen = record => record.jev.yes >= 0.5;
  const agree = judged.filter(record => wantsScreen(record) === record.heuristic);
  console.log(`Screen gate: Jev agrees on ${percent(agree.length, judged.length)}`);
  const line = record => `${record.jev.yes.toFixed(2)}  ${short(record.prompt)}`;
  show(
    'Jev would look, Edi did not (a blind answer, if Jev is right)',
    judged.filter(record => !record.heuristic && wantsScreen(record)),
    line,
  );
  show(
    'Edi looked, Jev would not (a wasted screenshot, if Jev is right)',
    judged.filter(record => record.heuristic && !wantsScreen(record)),
    line,
  );
  latency(screens);
  console.log();
}

if (turns.length) {
  const judged = answered(turns);
  const finished = record => record.jev.yes >= finishedAt;
  const line = record => `${record.jev.yes.toFixed(2)}  ${short(record.heard)}`;
  console.log(`End of turn, answering early when Jev is at least ${finishedAt} sure`);
  // Edi waited, and the person had in fact finished: the long pause ended the turn.
  const waited = judged.filter(record => record.outcome.next === 'long-pause');
  const saved = waited.filter(finished);
  const savedMs = saved.reduce(
    (total, record) => total + Math.max(0, record.outcome.afterMs - record.jev.ms),
    0,
  );
  console.log(
    `  Edi waited for the long pause: ${waited.length}; Jev would have answered ${saved.length} ` +
      `of them early, ${Math.round(savedMs / Math.max(1, saved.length))} ms sooner on average`,
  );
  // Edi waited, and the person did carry on: answering early would have cut them off.
  const resumed = judged.filter(record => record.outcome.next === 'resumed');
  show(
    `They carried on after Edi waited (${resumed.length}); Jev would have cut them off`,
    resumed.filter(finished),
    line,
  );
  show(
    'Edi answered at once, Jev thought they were mid-thought (check these by hand)',
    judged.filter(record => record.heuristic === 'finished' && record.jev.yes < 0.5),
    line,
  );
  latency(turns);
}
