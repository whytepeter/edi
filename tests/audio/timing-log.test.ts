import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  summarizeTimings,
  VoiceTimingLog,
  type VoiceTimingRecord,
} from '../../apps/desktop/src/main/voice/timing-log';

const turn = (firstSound: number, outcome: VoiceTimingRecord['outcome'] = 'answered') =>
  ({
    at: 1,
    model: 'test/model',
    reasoning: 'low',
    transcript: 200,
    screens: 210,
    started: 260,
    firstWords: firstSound - 300,
    toVoice: firstSound - 250,
    firstSound,
    finished: firstSound + 2_000,
    outcome,
  }) satisfies VoiceTimingRecord;

test('each spoken turn is kept as one line of numbers, and old turns make room', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'edi-timings-'));
  try {
    const path = join(folder, 'voice-timings.jsonl');
    const log = new VoiceTimingLog(path);
    await log.add(turn(900));
    await log.add(turn(1_400));
    const lines = (await readFile(path, 'utf8')).trim().split('\n');
    assert.equal(lines.length, 2);
    assert.equal((JSON.parse(lines[1]!) as VoiceTimingRecord).firstSound, 1_400);

    // Past the size cap the older half goes; the newest turn is always kept.
    for (let index = 0; index < 4_000; index++) void log.add(turn(1_000 + index));
    await log.add(turn(7_777));
    const kept = (await readFile(path, 'utf8')).trim().split('\n');
    assert.ok(kept.length < 4_003);
    assert.equal((JSON.parse(kept.at(-1)!) as VoiceTimingRecord).firstSound, 7_777);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('a timing that cannot be written never reaches the turn', async () => {
  const log = new VoiceTimingLog(join(tmpdir(), 'no-such-folder-edi', 'voice-timings.jsonl'));
  await assert.doesNotReject(log.add(turn(900)));
});

test('the summary gives the median and 90th percentile of answered turns only', () => {
  const records = [
    ...Array.from({ length: 9 }, (_, index) => turn(1_000 + index * 100)),
    turn(9_000),
    turn(60_000, 'stopped'),
  ];
  const summary = summarizeTimings(records);
  assert.equal(summary.turns, 11);
  assert.equal(summary.answered, 10);
  assert.deepEqual(summary.stages.firstSound, { p50: 1_500, p90: 9_000, turns: 10 });
  // A stage that never happened (no room noise taken out) is left out.
  assert.equal(summary.stages.sifted, undefined);
});
