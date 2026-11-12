import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CharacterMoodController } from '../../apps/desktop/src/main/character/character-mood';
import {
  answerShowsWords,
  moodLingers,
  ReplyReactions,
} from '../../apps/desktop/src/main/character/reply-reactions';

test('asked aloud, there is only the animation unless there is something to open or nothing to say it', () => {
  const text = 'Your next meeting is at half past two.';
  // Typed in the bubble: the words appear as they are written, and stay when it is done.
  assert.equal(answerShowsWords({ spoken: false, done: false, voiceIdle: true, text }), true);
  assert.equal(answerShowsWords({ spoken: false, done: true, voiceIdle: false, text }), true);
  // Asked aloud: nothing while Edi is thinking or speaking, nor when the text is done and the
  // voice still has it.
  assert.equal(answerShowsWords({ spoken: true, done: false, voiceIdle: false, text }), false);
  assert.equal(answerShowsWords({ spoken: true, done: false, voiceIdle: true, text }), false);
  assert.equal(answerShowsWords({ spoken: true, done: true, voiceIdle: false, text }), false);
  // The voice is off or failed: the finished answer is shown, so it is not lost.
  assert.equal(answerShowsWords({ spoken: true, done: true, voiceIdle: false, text: '' }), false);
  assert.equal(answerShowsWords({ spoken: true, done: true, voiceIdle: true, text }), true);
  // A link cannot be heard, only opened: the finished answer is shown even while it is spoken,
  // but not before it is complete.
  for (const linked of [
    'Here it is: https://example.com/brief',
    'See [the brief](https://x.co).',
  ]) {
    assert.equal(
      answerShowsWords({ spoken: true, done: true, voiceIdle: false, text: linked }),
      true,
    );
    assert.equal(
      answerShowsWords({ spoken: true, done: false, voiceIdle: false, text: linked }),
      false,
    );
  }
});

function stage() {
  const shown: string[] = [];
  const mood = new CharacterMoodController(value => shown.push(value));
  return { reactions: new ReplyReactions(mood), mood, shown };
}

test('the smile from the last answer ends when the person speaks again, so Edi looks like it is listening', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { reactions, mood } = stage();
  reactions.turnBegan();
  reactions.replyGrew('[MOOD:happy] Doing great, thanks.');
  reactions.replyEnded('[MOOD:happy] Doing great, thanks.');
  assert.equal(mood.current, 'happy');
  // A second later they hold to talk: a mood outranks the listening face, so it must go now.
  t.mock.timers.tick(1_000);
  reactions.voice('listening');
  assert.equal(mood.current, 'neutral');
  // The same when a typed request starts while the smile is still up.
  reactions.replyEnded('[MOOD:happy] Sure.');
  reactions.turnBegan();
  assert.equal(mood.current, 'neutral');
});

test('a spoken reply keeps its mood for as long as Edi is saying it, then lets it fade', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { reactions, mood, shown } = stage();
  reactions.voice('listening');
  reactions.voice('thinking');
  reactions.turnBegan(true);
  // The mood tag arrives with the first words, seconds before any sound. Nothing shows yet:
  // a face that lit up now looked like a laugh before the answer.
  reactions.replyGrew('[MOOD:happy] Here is');
  assert.deepEqual(shown, []);
  // The voice starts: now the face shows it.
  reactions.voice('speaking');
  assert.equal(mood.current, 'happy');
  reactions.replyEnded('[MOOD:happy] Here is a long answer, read aloud.');
  // The words finished long before the voice: the mood is still there twenty seconds in.
  t.mock.timers.tick(20_000);
  assert.equal(mood.current, 'happy');
  // A pause between sentences is not the end.
  reactions.voice('thinking');
  t.mock.timers.tick(moodLingers.afterSpeech - 500);
  reactions.voice('speaking');
  t.mock.timers.tick(5_000);
  assert.equal(mood.current, 'happy');
  // The voice stops: the mood stays a moment, then goes.
  reactions.voice('hidden');
  t.mock.timers.tick(moodLingers.afterSpeech - 1);
  assert.equal(mood.current, 'happy');
  t.mock.timers.tick(1);
  assert.equal(mood.current, 'neutral');
});

test('a short spoken reply whose text is done before the voice starts still shows its mood with the voice', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { reactions, mood, shown } = stage();
  reactions.voice('listening');
  reactions.voice('thinking');
  reactions.turnBegan(true);
  reactions.replyGrew('[MOOD:surprised] Oh!');
  reactions.replyEnded('[MOOD:surprised] Oh!');
  assert.deepEqual(shown, [], 'nothing before the voice');
  reactions.voice('speaking');
  assert.equal(mood.current, 'surprised');
  reactions.voice('hidden');
  t.mock.timers.tick(moodLingers.afterSpeech);
  assert.equal(mood.current, 'neutral');

  // The voice never speaks (it is off, or failed): the face stays as it was.
  reactions.voice('listening');
  reactions.turnBegan(true);
  reactions.replyGrew('[MOOD:happy] Done.');
  reactions.replyEnded('[MOOD:happy] Done.');
  reactions.voice('hidden');
  t.mock.timers.tick(30_000);
  assert.equal(mood.current, 'neutral');
});

test('a reply that is only read keeps its mood a few seconds; a failure looks sad; a stop is plain', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { reactions, mood } = stage();
  reactions.turnBegan();
  reactions.replyGrew('[MOOD:surprised] Oh');
  assert.equal(mood.current, 'surprised');
  reactions.replyEnded('[MOOD:surprised] Oh, that changed.');
  t.mock.timers.tick(moodLingers.afterWords - 1);
  assert.equal(mood.current, 'surprised');
  t.mock.timers.tick(1);
  assert.equal(mood.current, 'neutral');

  reactions.turnBegan();
  reactions.replyGrew('[MOOD:happy] Let me');
  reactions.replyEnded('', true);
  assert.equal(mood.current, 'sad');
  t.mock.timers.tick(moodLingers.afterFailure);
  assert.equal(mood.current, 'neutral');

  // Stopped by the person: whatever it was feeling, it does not linger.
  reactions.turnBegan();
  reactions.replyGrew('[MOOD:happy] Let me');
  reactions.replyEnded('');
  assert.equal(mood.current, 'neutral');
});
