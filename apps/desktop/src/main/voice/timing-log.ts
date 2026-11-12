import { appendFile, readFile, stat, writeFile } from 'node:fs/promises';
import type { VoiceTurnTiming } from './voice-controller';

/** One spoken turn as kept on disk: when, how long each stage took, and with which model. */
export interface VoiceTimingRecord extends VoiceTurnTiming {
  at: number;
  model: string;
  reasoning: string;
}

const MAX_BYTES = 512 * 1024;

/**
 * Where a spoken reply's wait goes, kept so it can be measured rather than guessed: numbers
 * only, never a word that was said. One JSON line per turn; past half a megabyte the older half
 * is dropped. `pnpm voice:report` reads it.
 */
export class VoiceTimingLog {
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  add(record: VoiceTimingRecord) {
    // One write at a time, and a failure never reaches the turn that was timed.
    this.writing = this.writing.then(() => this.append(record)).catch(() => {});
    return this.writing;
  }

  private async append(record: VoiceTimingRecord) {
    await appendFile(this.path, `${JSON.stringify(record)}\n`);
    const { size } = await stat(this.path);
    if (size <= MAX_BYTES) return;
    const lines = (await readFile(this.path, 'utf8')).split('\n').filter(Boolean);
    await writeFile(this.path, `${lines.slice(Math.floor(lines.length / 2)).join('\n')}\n`);
  }
}

const STAGES = [
  'transcript',
  'sifted',
  'screens',
  'started',
  'firstWords',
  'toVoice',
  'firstSound',
  'finished',
] as const;
export type VoiceStage = (typeof STAGES)[number];

export interface VoiceTimingSummary {
  turns: number;
  answered: number;
  /** Median and 90th percentile per stage, in milliseconds from the end of the person's turn. */
  stages: Partial<Record<VoiceStage, { p50: number; p90: number; turns: number }>>;
}

const percentile = (sorted: number[], share: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))]!;

/** Answered turns only: a stopped or failed turn says nothing about how long an answer takes. */
export function summarizeTimings(records: readonly VoiceTurnTiming[]): VoiceTimingSummary {
  const answered = records.filter(record => record.outcome === 'answered');
  const stages: VoiceTimingSummary['stages'] = {};
  for (const stage of STAGES) {
    const values = answered
      .flatMap(record => (typeof record[stage] === 'number' ? [record[stage]] : []))
      .sort((a, b) => a - b);
    if (values.length)
      stages[stage] = {
        p50: Math.round(percentile(values, 0.5)),
        p90: Math.round(percentile(values, 0.9)),
        turns: values.length,
      };
  }
  return { turns: records.length, answered: answered.length, stages };
}
