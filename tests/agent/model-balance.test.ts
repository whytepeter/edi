import test from 'node:test';
import assert from 'node:assert/strict';
import { modelForTurn, turnWeight } from '../../apps/desktop/src/main/agent/model-balance';

const weigh = (prompt: string) => turnWeight({ prompt });

test('everyday asks stay on the everyday model: talk, questions, lookups, chores, the screen', () => {
  for (const prompt of [
    'Hey Edi, how are you doing?',
    'What time is my next meeting?',
    "What's on my screen?",
    "What's the plan for today?",
    'Remind me to call the bank at three',
    'Write that down',
    'Draft a reminder to review the budget tomorrow',
    'Open Spotify and play something calm',
    'Can you hop?',
    'Summarise this page for me',
    'Who won the game last night?',
    'Add milk to my checklist',
  ])
    assert.equal(weigh(prompt), 'light', prompt);
});

test('writing, building, planning and analysing go to the hard-task model', () => {
  for (const prompt of [
    'Write a cover letter for the frontend role at Stripe',
    'Build me a small tic-tac-toe game',
    'Visualize the game you just suggested',
    'Compare these three laptops and tell me which to buy',
    'Plan my week around the launch on Thursday',
    'Review this pull request description',
    'Make me a report on our Q3 numbers',
    'Can you put together an itinerary for four days in Lisbon',
    'Debug why this function returns undefined',
    'Research the best way to learn Rust in a month',
    'Think carefully: is this contract clause enforceable?',
    'Explain how transformers work, step by step',
  ])
    assert.equal(weigh(prompt), 'heavy', prompt);
});

test('pasted material to work through is heavy: long, many lines, or code', () => {
  assert.equal(weigh('a '.repeat(250)), 'heavy');
  assert.equal(weigh('Fix this:\n```\nconst a = 1\n```'), 'heavy');
  assert.equal(weigh('one\ntwo\nthree\nfour'), 'heavy');
  // A background task is unattended work: quality over the first word.
  assert.equal(turnWeight({ prompt: 'Check my inbox', background: true }), 'heavy');
});

test('a turn goes to the hard-task model only when one was chosen and the turn is heavy', () => {
  const both = { everyday: 'google/gemini-flash', hard: 'anthropic/claude-opus' };
  assert.equal(modelForTurn(both, { prompt: 'How are you?' }), 'google/gemini-flash');
  assert.equal(modelForTurn(both, { prompt: 'Write a project proposal' }), 'anthropic/claude-opus');
  // No hard-task model: everything stays where it was.
  const one = { everyday: 'google/gemini-flash', hard: null };
  assert.equal(modelForTurn(one, { prompt: 'Write a project proposal' }), 'google/gemini-flash');
});
