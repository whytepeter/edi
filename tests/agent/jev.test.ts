import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JevClient, type JevAnswer } from '../../apps/desktop/src/main/jev/client';
import {
  JevShadow,
  jevShadowFromEnv,
  screenQuestion,
  turnQuestion,
  type ShadowRecord,
} from '../../apps/desktop/src/main/jev/shadow';

const tick = () => new Promise(resolve => setImmediate(resolve));
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('Jev is asked one yes/no question in the documented shape, and its noul is read', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const client = new JevClient('key-1', async (url, init) => {
    calls.push({ url, init });
    return json({
      model: 'jev-1.13.0',
      answers: { answer: { type: 'noul', noul: 0.83 } },
      usage: { input_tokens: 40, output_tokens: 0 },
    });
  });
  const answer = await client.yesNo({ request: 'what is this button?' }, screenQuestion);
  assert.deepEqual({ ...answer, ms: 0 }, { ok: true, yes: 0.83, ms: 0 });
  assert.equal(calls[0]?.url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(calls[0]?.init.method, 'POST');
  assert.deepEqual(calls[0]?.init.headers, {
    Authorization: 'Bearer key-1',
    'Content-Type': 'application/json',
  });
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), {
    model: 'jev-latest',
    state: { request: 'what is this button?' },
    questions: { answer: { type: 'noul', ...screenQuestion } },
  });
});

test('a refused, malformed or failed request is an answer with a reason, never a throw', async () => {
  const ask = (fetchImpl: () => Promise<Response>) =>
    new JevClient('key', fetchImpl).yesNo({ words_so_far: 'hi' }, turnQuestion);
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

test('shadow mode needs a development run, EDI_JEV_SHADOW=on and a key', () => {
  const on = { EDI_JEV_SHADOW: 'on', TYPESAFE_API_KEY: 'key' };
  const make = (packaged: boolean, env: Record<string, string>) =>
    jevShadowFromEnv({ packaged, logPath: '/dev/null', env });
  assert.ok(make(false, on) instanceof JevShadow);
  assert.equal(make(true, on), null, 'never in a packaged app');
  assert.equal(make(false, { TYPESAFE_API_KEY: 'key' }), null, 'a key alone does not turn it on');
  assert.equal(make(false, { EDI_JEV_SHADOW: 'on', TYPESAFE_API_KEY: ' ' }), null);
});
