import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initialVoiceSession,
  transitionVoice,
  type VoiceEvent,
  type VoiceMode,
} from '../../packages/contracts/src/voice-session';

type Simple = Extract<VoiceEvent, { generation: number; type: 'capture-ready' }>['type'];

function session(mode: VoiceMode) {
  let state = transitionVoice(initialVoiceSession, { type: 'start', mode }).state;
  const apply = (event: VoiceEvent) => {
    const next = transitionVoice(state, event);
    state = next.state;
    return next.effects;
  };
  return {
    get state() {
      return state;
    },
    event(
      type: Simple | 'speech-detected' | 'release' | 'converse' | 'idle-timeout' | 'failed',
      generation = state.generation,
    ) {
      return apply({ type, generation });
    },
    reply(
      type: 'reply-started' | 'reply-quiet' | 'reply-ended',
      turn = state.turn,
      generation = state.generation,
    ) {
      return apply({ type, generation, turn });
    },
    endOfTurn(heard: boolean) {
      return apply({ type: 'end-of-turn', generation: state.generation, heard });
    },
    stop() {
      state = transitionVoice(state, { type: 'stop' }).state;
    },
  };
}

test('push-to-talk submits exactly once on release, not on pauses', () => {
  const s = session('push-to-talk');
  assert.equal(s.state.phase, 'opening');
  s.event('capture-ready');
  s.event('speech-detected');
  assert.deepEqual(s.endOfTurn(true), []);
  assert.deepEqual(s.event('release'), ['close-microphone', 'submit-turn']);
  assert.deepEqual(s.event('release'), []);
  assert.equal(s.state.turn, 1);
  s.reply('reply-started');
  s.reply('reply-ended');
  assert.equal(s.state.phase, 'idle');
});

test('a hands-free conversation keeps the microphone open between turns', () => {
  const s = session('conversation');
  s.event('capture-ready');
  assert.deepEqual(s.event('release'), []);
  // A pause with no words keeps listening.
  s.event('speech-detected');
  assert.deepEqual(s.endOfTurn(false), []);
  assert.equal(s.state.phase, 'listening');
  s.event('speech-detected');
  assert.deepEqual(s.endOfTurn(true), ['submit-turn']);
  assert.equal(s.state.phase, 'processing');
  s.reply('reply-started');
  const generation = s.state.generation;
  assert.deepEqual(s.reply('reply-ended'), []);
  assert.equal(s.state.phase, 'listening');
  assert.equal(s.state.generation, generation, 'same microphone session');
});

test('talking over a reply pauses it; words cancel it and start the new request', () => {
  const s = session('conversation');
  s.event('capture-ready');
  s.event('speech-detected');
  s.endOfTurn(true);
  const first = s.state.turn;
  s.reply('reply-started');
  assert.deepEqual(s.event('speech-detected'), ['pause-reply']);
  assert.equal(s.state.interrupting, true);
  assert.deepEqual(s.event('speech-detected'), [], 'only one pause per interruption');
  assert.deepEqual(s.endOfTurn(true), ['cancel-reply', 'submit-turn']);
  assert.equal(s.state.phase, 'processing');
  assert.equal(s.state.turn, first + 1);
  // The cancelled reply finishing late cannot end the new turn.
  assert.deepEqual(s.reply('reply-ended', first), []);
  assert.equal(s.state.phase, 'processing');
});

test('noise over a reply resumes it, including while tools are still running', () => {
  const s = session('conversation');
  s.event('capture-ready');
  s.event('speech-detected');
  s.endOfTurn(true);
  assert.equal(s.state.phase, 'processing');
  assert.deepEqual(s.event('speech-detected'), ['pause-reply']);
  assert.deepEqual(s.endOfTurn(false), ['resume-reply']);
  assert.equal(s.state.interrupting, false);
  assert.equal(s.state.phase, 'processing');
});

test('push-to-talk never pauses a reply for speech; a new hold replaces it instead', () => {
  const s = session('push-to-talk');
  s.event('capture-ready');
  s.event('speech-detected');
  s.event('release');
  s.reply('reply-started');
  assert.deepEqual(s.event('speech-detected'), []);
  const next = transitionVoice(s.state, { type: 'start', mode: 'push-to-talk' });
  assert.deepEqual(next.effects, ['cancel-all', 'open-microphone']);
});

test('a quick tap turns push-to-talk into a conversation, only before anything was said', () => {
  const s = session('push-to-talk');
  assert.deepEqual(s.event('converse'), []);
  assert.equal(s.state.mode, 'conversation');
  const said = session('push-to-talk');
  said.event('capture-ready');
  said.event('speech-detected');
  said.event('converse');
  assert.equal(said.state.mode, 'push-to-talk');
});

test('hands-free listening ends after a long silence, never mid-utterance', () => {
  const s = session('conversation');
  s.event('capture-ready');
  s.event('speech-detected');
  assert.deepEqual(s.event('idle-timeout'), []);
  s.endOfTurn(false);
  assert.deepEqual(s.event('idle-timeout'), ['cancel-all']);
  assert.equal(s.state.phase, 'idle');
});

test('release before permission resolves cancels; stale ready cannot reopen mic', () => {
  const s = session('push-to-talk');
  const old = s.state.generation;
  assert.deepEqual(s.event('release'), ['cancel-all']);
  s.event('capture-ready', old);
  assert.equal(s.state.phase, 'idle');
});

test('empty holds do not submit, and errors cancel the entire session', () => {
  const s = session('push-to-talk');
  s.event('capture-ready');
  assert.deepEqual(s.event('release'), ['cancel-all']);
  const c = session('conversation');
  assert.deepEqual(c.event('failed'), ['cancel-all']);
  assert.equal(c.state.phase, 'error');
});

test('Stop invalidates pending replies and prevents hands-free reactivation', () => {
  const s = session('conversation');
  s.event('capture-ready');
  s.event('speech-detected');
  s.endOfTurn(true);
  const old = s.state.generation;
  s.stop();
  s.reply('reply-ended', s.state.turn, old);
  assert.equal(s.state.phase, 'idle');
});

test('between bursts of speech the reply is back to working, and speaking again when sound returns', () => {
  const s = session('push-to-talk');
  s.event('capture-ready');
  s.event('speech-detected');
  s.event('release');
  s.reply('reply-started');
  assert.equal(s.state.phase, 'speaking');
  s.reply('reply-quiet');
  assert.equal(s.state.phase, 'processing');
  s.reply('reply-started');
  assert.equal(s.state.phase, 'speaking');
  s.reply('reply-quiet', s.state.turn - 1);
  assert.equal(s.state.phase, 'speaking', 'an older turn cannot quiet this one');
});
