import test from 'node:test';
import assert from 'node:assert/strict';
import { initialVoiceSession, transitionVoice, type VoiceMode, type VoiceEvent } from '../../packages/contracts/src/voice-session';

function session(mode: VoiceMode) {
  let state = transitionVoice(initialVoiceSession, { type: 'start', mode }).state;
  return {
    get state() { return state; },
    event(type: Exclude<VoiceEvent['type'], 'start' | 'stop'>, generation = state.generation) {
      const next = transitionVoice(state, { type, generation });
      state = next.state;
      return next.effects;
    },
    stop() { state = transitionVoice(state, { type: 'stop' }).state; },
  };
}
test('PTT submits exactly once on release, not on silence', () => {
  const s = session('push-to-talk');
  assert.equal(s.state.phase, 'opening');
  s.event('capture-ready'); s.event('speech-detected');
  assert.deepEqual(s.event('silence'), []);
  assert.deepEqual(s.event('release'), ['close-microphone', 'submit-turn']);
  assert.deepEqual(s.event('release'), []);
  s.event('reply-started'); s.event('reply-ended');
  assert.equal(s.state.phase, 'idle');
});
test('conversation waits for speech, then resumes after its reply with a fresh token', () => {
  const s = session('conversation');
  s.event('capture-ready');
  assert.deepEqual(s.event('silence'), []);
  assert.deepEqual(s.event('release'), []);
  s.event('speech-detected');
  assert.deepEqual(s.event('silence'), ['close-microphone', 'submit-turn']);
  const old = s.state.generation;
  s.event('reply-started');
  assert.deepEqual(s.event('reply-ended'), ['open-microphone']);
  assert.equal(s.state.phase, 'opening');
  assert.deepEqual(s.event('capture-ready', old), []);
  assert.equal(s.state.phase, 'opening');
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
  s.event('capture-ready'); s.event('speech-detected'); s.event('silence');
  const old = s.state.generation;
  s.stop(); s.event('reply-ended', old);
  assert.equal(s.state.phase, 'idle');
});
