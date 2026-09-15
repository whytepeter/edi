import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SpeechActivity,
  soundsUnfinished,
  type SpeechActivityEvent,
} from '../../packages/contracts/src/voice-turns';
import { SpokenProgress, spokenLabel } from '../../apps/desktop/src/main/voice/spoken-progress';
import type { AgentState } from '../../packages/contracts/src/index';

test('a pause after a hesitation or a joining word is not the end of a turn', () => {
  for (const unfinished of [
    'Can you…',
    'Can you, um',
    'Can you um.',
    'Check my emails from',
    'Remind me to call mum and',
    'Add milk,',
    'Could you check the',
    '',
  ])
    assert.equal(soundsUnfinished(unfinished), true, unfinished);
  for (const finished of [
    'Can you check my calendar tomorrow?',
    'Check my emails.',
    'Thank you.',
    'Turn it on.',
    'Do it',
    'What time is it',
    'Stop!',
  ])
    assert.equal(soundsUnfinished(finished), false, finished);
});

/** Feed levels as 20 ms frames: [rms, frames] pairs. Returns events with their frame index. */
function run(activity: SpeechActivity, plan: [number, number][], speaking = false) {
  const events: [number, SpeechActivityEvent][] = [];
  let index = 0;
  for (const [rms, count] of plan)
    for (let i = 0; i < count; i++, index++)
      for (const event of activity.frame(rms, 20, speaking)) events.push([index, event]);
  return events;
}

test('speech, a pause and a long pause come from loudness over time', () => {
  const activity = new SpeechActivity();
  const events = run(activity, [
    [0.002, 50], // a quiet room teaches the noise floor
    [0.1, 30], // 600 ms of speech
    [0.002, 40], // 800 ms pause: pause at 600 ms
    [0.1, 20], // they carry on
    [0.002, 100], // then stop for 2 s
  ]);
  assert.deepEqual(
    events.map(([, event]) => event),
    ['speech', 'pause', 'speech', 'pause', 'long-pause'],
  );
  // Speech is reported after the onset time (240 ms), not on the first loud frame.
  assert.equal(events[0]?.[0], 50 + 11);
  assert.equal(activity.active, false);
});

test('a click or a cough does not count as speech', () => {
  const activity = new SpeechActivity();
  const events = run(activity, [
    [0.002, 50],
    [0.2, 3],
    [0.002, 10],
    [0.2, 2],
    [0.002, 50],
    // A door or a burst of typing: 200 ms of loud sound.
    [0.2, 10],
    [0.002, 50],
  ]);
  assert.deepEqual(events, []);
});

test('while Edi speaks, quiet echo is ignored but a clear voice still interrupts', () => {
  const echo = new SpeechActivity();
  assert.deepEqual(
    run(
      echo,
      [
        [0.002, 50],
        [0.025, 50],
      ],
      true,
    ),
    [],
  );
  const voice = new SpeechActivity();
  const events = run(
    voice,
    [
      [0.002, 50],
      [0.12, 30],
    ],
    true,
  );
  assert.deepEqual(
    events.map(([, event]) => event),
    ['speech'],
  );
  assert.equal(events[0]?.[0], 50 + 15, 'needs 320 ms while Edi talks');
});

const step = (capability: string, title: string, status = 'running' as const) => ({
  callId: '00000000-0000-4000-8000-000000000009',
  capability,
  title,
  status,
  summary: '',
});
const state = (steps: AgentState['steps'], approval: AgentState['approval'] = null) => ({
  steps,
  activity: null,
  approval,
});

test('spoken progress: one acknowledgement, one line per quiet step, then one "still working"', () => {
  const progress = new SpokenProgress({ stepQuietMs: 1000, stillQuietMs: 5000 }, () => 0);
  const busy = state([step('calendar.events', 'Calendar')]);
  assert.equal(progress.workStarted(busy), true);
  assert.equal(progress.next(busy, 0, { spokeAnything: false, quietMs: 0 }), 'Let me check.');
  assert.equal(progress.workStarted(busy), false);
  assert.equal(progress.next(busy, 500, { spokeAnything: true, quietMs: 500 }), null);
  assert.equal(
    progress.next(busy, 1200, { spokeAnything: true, quietMs: 1200 }),
    'Checking your calendar.',
  );
  assert.equal(progress.next(busy, 2000, { spokeAnything: true, quietMs: 2000 }), null);
  assert.equal(
    progress.next(busy, 6000, { spokeAnything: true, quietMs: 6000 }),
    'Still working on it.',
  );
  assert.equal(progress.next(busy, 20_000, { spokeAnything: true, quietMs: 20_000 }), null);
});

test('spoken progress: the model’s own acknowledgement is enough; actions sound like actions', () => {
  const said = new SpokenProgress(undefined, () => 0);
  const busy = state([step('reminders.create', 'Add reminder')]);
  assert.equal(said.next(busy, 0, { spokeAnything: true, quietMs: 0 }), null);
  const fresh = new SpokenProgress(undefined, () => 0);
  assert.equal(fresh.next(busy, 0, { spokeAnything: false, quietMs: 0 }), 'On it.');
});

test('spoken progress: an approval is mentioned once, when Edi is not talking', () => {
  const progress = new SpokenProgress(undefined, () => 0);
  const waiting = state(
    [step('files.move', 'Move files', 'awaiting-approval' as 'running')],
    {} as AgentState['approval'],
  );
  assert.equal(progress.next(waiting, 0, { spokeAnything: false, quietMs: 0 }), null);
  assert.equal(
    progress.next(waiting, 10, { spokeAnything: false, quietMs: 10 }),
    'I need your okay for that.',
  );
  assert.equal(progress.next(waiting, 20, { spokeAnything: true, quietMs: 20 }), null);
});

test('connected apps are named in progress; unknown tools say nothing specific', () => {
  assert.equal(
    spokenLabel('composio_gmail.GMAIL_FETCH_EMAILS', 'Gmail: Fetch emails'),
    'Working in Gmail.',
  );
  assert.equal(spokenLabel('web.search', 'Search'), 'Searching the web.');
  assert.equal(spokenLabel('something.else', 'Something'), null);
});
