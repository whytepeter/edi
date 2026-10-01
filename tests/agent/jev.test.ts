import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  JevClient,
  type JevAnswer,
  type JevAnswers,
  type JevState,
  type YesNoQuestion,
} from '../../apps/desktop/src/main/jev/client';
import {
  JevHearing,
  forEdiQuestion,
  sentenceQuestion,
  type HearingContext,
  type HearingRecord,
} from '../../apps/desktop/src/main/jev/hearing';
import { jevFromEnv } from '../../apps/desktop/src/main/jev/setup';
import {
  JevShadow,
  screenQuestion,
  turnQuestion,
  type ShadowRecord,
} from '../../apps/desktop/src/main/jev/shadow';

const tick = () => new Promise(resolve => setImmediate(resolve));
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('Jev is asked one yes/no question through OpenRouter, and its noul is read', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const client = new JevClient(
    () => 'key-1',
    async (url, init) => {
      calls.push({ url, init });
      return json({
        id: 'gen-dec-1',
        model: 'typesafe/jev-1.13-20260917',
        provider: 'TypeSafe',
        answers: { answer: { type: 'noul', noul: 0.83 } },
        usage: { input_tokens: 40, output_tokens: 0, cost: 0.000002 },
      });
    },
  );
  const answer = await client.yesNo({ request: 'what is this button?' }, screenQuestion);
  assert.deepEqual({ ...answer, ms: 0 }, { ok: true, yes: 0.83, ms: 0 });
  assert.equal(calls[0]?.url, 'https://openrouter.ai/api/v1/systemone');
  assert.equal(calls[0]?.init.method, 'POST');
  assert.deepEqual(calls[0]?.init.headers, {
    Authorization: 'Bearer key-1',
    'Content-Type': 'application/json',
  });
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), {
    model: 'typesafe/jev-1.13',
    state: { request: 'what is this button?' },
    questions: { answer: { type: 'noul', ...screenQuestion } },
  });
});

test('the OpenRouter key is read on each question, and nothing is sent without one', async () => {
  let key = '';
  const sentWith: unknown[] = [];
  const client = new JevClient(
    () => key,
    async (_url, init) => {
      sentWith.push((init.headers as Record<string, string>).Authorization);
      return json({ answers: { answer: { type: 'noul', noul: 0.5 } } });
    },
  );
  assert.deepEqual(await client.yesNo({ request: 'hi' }, screenQuestion), {
    ok: false,
    error: 'no OpenRouter key',
    ms: 0,
  });
  key = 'saved-later';
  assert.equal((await client.yesNo({ request: 'hi' }, screenQuestion)).ok, true);
  assert.deepEqual(sentWith, ['Bearer saved-later']);
});

test('several questions go in one request, each answer read by its id', async () => {
  const bodies: unknown[] = [];
  const signals: (AbortSignal | null | undefined)[] = [];
  const client = new JevClient(
    () => 'key',
    async (_url, init) => {
      bodies.push(JSON.parse(String(init.body)));
      signals.push(init.signal);
      return json({ answers: { a: { type: 'noul', noul: 0.1 }, b: { type: 'noul', noul: 0.7 } } });
    },
  );
  const both = await client.ask({ heard: 'hi' }, { a: screenQuestion, b: turnQuestion }, 600);
  assert.deepEqual(both.ok && both.yes, { a: 0.1, b: 0.7 });
  assert.deepEqual((bodies[0] as { questions: unknown }).questions, {
    a: { type: 'noul', ...screenQuestion },
    b: { type: 'noul', ...turnQuestion },
  });
  assert.ok(signals[0] instanceof AbortSignal, 'a deadline goes with the request');
  // One answer missing makes the whole response unusable.
  const missing = await client.ask({}, { a: screenQuestion, b: turnQuestion, c: turnQuestion });
  assert.deepEqual(missing.ok ? 'answered' : missing.error, 'unexpected response');
});

test('a refused, malformed or failed request is an answer with a reason, never a throw', async () => {
  const ask = (fetchImpl: () => Promise<Response>) =>
    new JevClient(() => 'key', fetchImpl).yesNo({ words_so_far: 'hi' }, turnQuestion);
  const reason = (answer: JevAnswer) => (answer.ok ? 'answered' : answer.error);
  assert.equal(reason(await ask(async () => json({ detail: 'slow down' }, 429))), 'HTTP 429');
  assert.equal(
    reason(await ask(async () => json({ answers: { answer: { noul: 'yes' } } }))),
    'unexpected response',
  );
  assert.equal(reason(await ask(async () => json(null))), 'unexpected response');
  assert.match(
    reason(
      await ask(async () => {
        throw new TypeError('fetch failed');
      }),
    ),
    /fetch failed/,
  );
  const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
  assert.equal(
    reason(
      await ask(async () => {
        throw timeout;
      }),
    ),
    'timeout',
  );
});

/** A shadow whose Jev answers `yes` to everything, recording what it would write. */
function shadow(yes = 0.9, outcomeWaitMs = 10_000) {
  const written: ShadowRecord[] = [];
  const asked: Record<string, string>[] = [];
  const jev = {
    yesNo: async (state: Record<string, string>) => {
      asked.push(state);
      return { ok: true as const, yes, ms: 120 };
    },
  };
  return {
    written,
    asked,
    shadow: new JevShadow(
      jev,
      record => written.push(record),
      () => 1_000,
      outcomeWaitMs,
    ),
  };
}

test('each screen decision is written beside what Jev says, the decision unchanged', async () => {
  const s = shadow(0.91);
  s.shadow.screenGate("what's wrong with this?", false, false);
  await tick();
  assert.deepEqual(s.asked, [
    { request: "what's wrong with this?", previous_turn_used_screen: 'no' },
  ]);
  assert.deepEqual(s.written, [
    {
      kind: 'screen',
      at: 1_000,
      prompt: "what's wrong with this?",
      followUp: false,
      heuristic: false,
      jev: { ok: true, yes: 0.91, ms: 120 },
    },
  ]);
});

test('a pause judged finished is written at once; one judged unfinished waits for what followed', async () => {
  const s = shadow(0.95);
  s.shadow.endOfTurn('Check my emails.', false);
  const report = s.shadow.endOfTurn('Remind me to call mum and', true);
  await tick();
  assert.deepEqual(
    s.written.map(record => record.kind === 'turn' && [record.heard, record.outcome]),
    [['Check my emails.', { next: 'answered' }]],
  );
  report({ next: 'long-pause', afterMs: 1_200 });
  await tick();
  assert.deepEqual(s.written[1], {
    kind: 'turn',
    at: 1_000,
    heard: 'Remind me to call mum and',
    heuristic: 'unfinished',
    outcome: { next: 'long-pause', afterMs: 1_200 },
    jev: { ok: true, yes: 0.95, ms: 120 },
  });
});

test('an outcome that never arrives is written as unknown; noise is never sent', async () => {
  const s = shadow(0.4, 10);
  s.shadow.endOfTurn('Can you um', true);
  s.shadow.endOfTurn('   ', true)({ next: 'resumed', afterMs: 50 });
  await wait(30);
  assert.equal(s.asked.length, 1);
  assert.deepEqual(
    s.written.map(record => record.kind === 'turn' && record.outcome),
    [{ next: 'unknown' }],
  );
});

test('checks beyond four waiting on Jev are skipped, not queued', async () => {
  const written: ShadowRecord[] = [];
  const pending: (() => void)[] = [];
  const jev = {
    yesNo: () =>
      new Promise<JevAnswer>(resolve => {
        pending.push(() => resolve({ ok: true, yes: 0.5, ms: 900 }));
      }),
  };
  const s = new JevShadow(jev, record => written.push(record));
  for (let i = 0; i < 5; i++) s.screenGate(`prompt ${i}`, false, false);
  await tick();
  assert.equal(pending.length, 4);
  assert.deepEqual(
    written.map(record => record.kind === 'screen' && [record.prompt, record.jev]),
    [['prompt 4', 'skipped']],
  );
  pending.forEach(resolve => resolve());
  await tick();
  assert.equal(written.length, 5);
  s.screenGate('after', false, false);
  await tick();
  assert.equal(pending.length, 5, 'room again once answers arrive');
});

test('Jev needs a development run and EDI_JEV=on or decide, not a second key', () => {
  const on = { EDI_JEV: 'on' };
  const make = (packaged: boolean, env: Record<string, string>) =>
    jevFromEnv({ packaged, logPath: '/dev/null', apiKey: () => 'openrouter-key', env });
  const jev = make(false, on);
  assert.ok(jev?.shadow instanceof JevShadow);
  assert.ok(jev?.hearing instanceof JevHearing);
  assert.equal(jev?.hearing.decides, false, 'on records; it does not decide');
  assert.equal(make(false, { EDI_JEV: 'decide' })?.hearing.decides, true);
  assert.equal(make(true, on), null, 'never in a packaged app');
  assert.equal(make(true, { EDI_JEV: 'decide' }), null);
  assert.equal(make(false, {}), null, 'the OpenRouter key alone does not turn it on');
  assert.equal(make(false, { EDI_JEV: 'yes' }), null);
});

/**
 * A deciding hearing (or `decides: false`, recording only) whose Jev answers from `yes` by
 * question id, recording what it was asked.
 */
function hearing(yes: Record<string, number> | { error: string }, decides = true) {
  const asked: { state: JevState; questions: Record<string, YesNoQuestion>; timeoutMs?: number }[] =
    [];
  const written: HearingRecord[] = [];
  const jev = {
    ask: async <Id extends string>(
      state: JevState,
      questions: Record<Id, YesNoQuestion>,
      timeoutMs?: number,
    ): Promise<JevAnswers<Id>> => {
      asked.push({ state, questions, timeoutMs });
      if ('error' in yes) return { ok: false, error: String(yes.error), ms: 600 };
      const ids = Object.keys(questions) as Id[];
      return {
        ok: true,
        yes: Object.fromEntries(
          ids.map(id => [id, (yes as Record<string, number>)[id] ?? 0.9]),
        ) as Record<Id, number>,
        ms: 210,
      };
    },
  };
  return {
    asked,
    written,
    hearing: new JevHearing(
      jev,
      record => written.push(record),
      decides,
      () => 5,
    ),
  };
}

const context: HearingContext = {
  name: 'Edi',
  lastReply: 'You have two meetings tomorrow. Want me to move the first one?',
  lastRequest: 'What is on my calendar tomorrow?',
  interrupting: false,
};

test('words from the room are let go only when Jev is sure they were not for Edi', async () => {
  const room = hearing({ for_edi: 0.06 });
  assert.equal(await room.hearing.sift('And now, the weather for the weekend.', context), '');
  assert.deepEqual(room.asked[0]?.questions, { for_edi: forEdiQuestion });
  assert.equal(room.asked[0]?.timeoutMs, 1_500, 'a live check is never waited on for long');
  assert.deepEqual(room.asked[0]?.state, {
    heard: 'And now, the weather for the weekend.',
    conversation: {
      edi_said_last: context.lastReply,
      person_asked_before: context.lastRequest,
      edi_was_speaking: 'no',
    },
  });
  assert.deepEqual(room.written, [
    {
      kind: 'heard',
      at: 5,
      heard: 'And now, the weather for the weekend.',
      interrupting: false,
      kept: '',
      decided: true,
      jev: { ok: true, forEdi: 0.06, sentences: [], ms: 210 },
    },
  ]);

  // Unsure is not sure: a short answer to Edi's question stays.
  const unsure = hearing({ for_edi: 0.35 });
  assert.equal(await unsure.hearing.sift('Yes, do that.', context), 'Yes, do that.');
});

test('stray sentences are taken out of words that were for Edi', async () => {
  const mixed = hearing({ for_edi: 0.92, sentence_0: 0.95, sentence_1: 0.04, sentence_2: 0.88 });
  const heard = 'Move it to Friday. Stay tuned after the break. And tell Sam.';
  assert.equal(await mixed.hearing.sift(heard, context), 'Move it to Friday. And tell Sam.');
  assert.deepEqual(Object.keys(mixed.asked[0]?.questions ?? {}), [
    'for_edi',
    'sentence_0',
    'sentence_1',
    'sentence_2',
  ]);
  assert.deepEqual(
    mixed.asked[0]?.questions.sentence_1,
    sentenceQuestion('Stay tuned after the break.'),
  );
  assert.deepEqual(mixed.written[0]?.jev, {
    ok: true,
    forEdi: 0.92,
    sentences: [0.95, 0.04, 0.88],
    ms: 210,
  });

  // For Edi, but no sentence was: the answers disagree, so every word stays.
  const torn = hearing({ for_edi: 0.6, sentence_0: 0.1, sentence_1: 0.1 });
  assert.equal(await torn.hearing.sift('Sure. Go ahead.', context), 'Sure. Go ahead.');
});

test('her name, nothing heard or a failed check never loses a word', async () => {
  const named = hearing({ for_edi: 0 });
  assert.equal(
    await named.hearing.sift('Okay Edi, read it again.', context),
    'Okay Edi, read it again.',
  );
  assert.equal(await named.hearing.sift('   ', context), '   ');
  assert.equal(named.asked.length, 0, 'nothing to ask');
  // "Edinburgh" is not her name.
  await named.hearing.sift('Book a train to Edinburgh.', context);
  assert.equal(named.asked.length, 1);

  const failed = hearing({ error: 'timeout' });
  const over = { ...context, interrupting: true };
  assert.equal(await failed.hearing.sift('Wait, stop.', over), 'Wait, stop.');
  assert.equal(
    (failed.asked[0]?.state.conversation as { edi_was_speaking: string }).edi_was_speaking,
    'yes, and these words came over her',
  );
  assert.deepEqual(failed.written[0], {
    kind: 'heard',
    at: 5,
    heard: 'Wait, stop.',
    interrupting: true,
    kept: 'Wait, stop.',
    decided: true,
    jev: { ok: false, error: 'timeout', ms: 600 },
  });
});

test('a long turn is judged whole, not sentence by sentence', async () => {
  const long = hearing({ for_edi: 0.9 });
  const heard = Array.from({ length: 9 }, (_, i) => `Point ${i + 1}.`).join(' ');
  assert.equal(await long.hearing.sift(heard, context), heard);
  assert.deepEqual(Object.keys(long.asked[0]?.questions ?? {}), ['for_edi']);
});

test('recording only, every word goes on at once and Jev’s verdict is written beside it', async () => {
  const recorded = hearing({ for_edi: 0.04 }, false);
  assert.equal(
    await recorded.hearing.sift('And now, the weather.', context),
    'And now, the weather.',
  );
  await tick();
  assert.deepEqual(recorded.written[0], {
    kind: 'heard',
    at: 5,
    heard: 'And now, the weather.',
    interrupting: false,
    kept: '',
    decided: false,
    jev: { ok: true, forEdi: 0.04, sentences: [], ms: 210 },
  });

  // A Jev that never answers holds nothing up.
  const stuck = new JevHearing({ ask: () => new Promise<never>(() => {}) }, () => {}, false);
  assert.equal(await stuck.sift('Check my emails.', context), 'Check my emails.');
});
