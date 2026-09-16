/** Pure session policy. Capture, turn detection, transcription and playback execute the effects. */
export type VoiceMode = 'push-to-talk' | 'conversation';
export interface VoiceSession {
  /**
   * The microphone session. Start, Stop and failures bump it, so everything from an older
   * session (a late capture event, a transcript, a reply) is ignored.
   */
  generation: number;
  /** Bumped for every submitted question: replies and playback belong to one turn. */
  turn: number;
  mode: VoiceMode | null;
  phase: 'idle' | 'opening' | 'listening' | 'processing' | 'speaking' | 'error';
  /** The current utterance has had speech in it. */
  speechDetected: boolean;
  /** Conversation: the person started talking over a reply, which waits until their words are in. */
  interrupting: boolean;
}
export type VoiceEffect =
  | 'cancel-all'
  | 'open-microphone'
  | 'close-microphone'
  | 'submit-turn'
  /** Hold the reply's audio where it is; nothing is thrown away yet. */
  | 'pause-reply'
  /** The interruption was only noise: carry on speaking. */
  | 'resume-reply'
  /** The person said something over the reply: drop its audio and stop the work behind it. */
  | 'cancel-reply';
export type VoiceEvent =
  | { type: 'start'; mode: VoiceMode }
  | { type: 'stop' }
  | {
      type:
        | 'capture-ready'
        | 'speech-detected'
        | 'release'
        /** A quick tap turned a push-to-talk hold into a hands-free conversation. */
        | 'converse'
        /** Hands-free listening went on too long without anyone speaking. */
        | 'idle-timeout'
        | 'failed';
      generation: number;
    }
  /** `reply-quiet`: the reply's audio stopped for now (a tool is running), though work goes on. */
  | { type: 'reply-started' | 'reply-quiet' | 'reply-ended'; generation: number; turn: number }
  /** The turn detector decided the person finished; `heard` is whether they said any words. */
  | { type: 'end-of-turn'; generation: number; heard: boolean };

export const initialVoiceSession: VoiceSession = {
  generation: 0,
  turn: 0,
  mode: null,
  phase: 'idle',
  speechDetected: false,
  interrupting: false,
};

export function transitionVoice(
  state: VoiceSession,
  event: VoiceEvent,
): {
  state: VoiceSession;
  effects: VoiceEffect[];
} {
  const result = (next: VoiceSession, ...effects: VoiceEffect[]) => ({ state: next, effects });
  const idle = () => ({
    ...initialVoiceSession,
    generation: state.generation + 1,
    turn: state.turn,
  });
  if (event.type === 'stop') return result(idle(), 'cancel-all');
  if (event.type === 'start') {
    return result(
      {
        generation: state.generation + 1,
        turn: state.turn,
        mode: event.mode,
        phase: 'opening',
        speechDetected: false,
        interrupting: false,
      },
      'cancel-all',
      'open-microphone',
    );
  }
  if (event.generation !== state.generation || state.mode === null) return result(state);
  // A reply from an older turn (one the person talked over) cannot end or start a newer one.
  if ('turn' in event && event.turn !== state.turn) return result(state);
  const talking = state.phase === 'processing' || state.phase === 'speaking';

  if (event.type === 'failed') {
    return result({ ...idle(), phase: 'error' }, 'cancel-all');
  }
  if (event.type === 'capture-ready' && state.phase === 'opening') {
    return result({ ...state, phase: 'listening' });
  }
  if (event.type === 'converse' && state.mode === 'push-to-talk' && !state.speechDetected) {
    if (state.phase === 'opening' || state.phase === 'listening')
      return result({ ...state, mode: 'conversation' });
  }
  if (event.type === 'speech-detected') {
    if (state.phase === 'listening') return result({ ...state, speechDetected: true });
    // Hands-free barge-in: the reply pauses at once; the person's words decide what happens next.
    if (state.mode === 'conversation' && talking && !state.interrupting)
      return result({ ...state, speechDetected: true, interrupting: true }, 'pause-reply');
  }
  if (event.type === 'release' && state.mode === 'push-to-talk') {
    if (state.phase === 'opening') return result(idle(), 'cancel-all');
    if (state.phase === 'listening') {
      if (!state.speechDetected) return result(idle(), 'cancel-all');
      return result(
        { ...state, phase: 'processing', turn: state.turn + 1 },
        'close-microphone',
        'submit-turn',
      );
    }
  }
  if (event.type === 'end-of-turn' && state.mode === 'conversation') {
    if (state.phase === 'listening') {
      if (!event.heard) return result({ ...state, speechDetected: false });
      // The microphone stays open: the person can talk over the reply.
      return result(
        { ...state, phase: 'processing', turn: state.turn + 1, speechDetected: false },
        'submit-turn',
      );
    }
    if (talking && state.interrupting) {
      if (!event.heard)
        return result({ ...state, speechDetected: false, interrupting: false }, 'resume-reply');
      return result(
        {
          ...state,
          phase: 'processing',
          turn: state.turn + 1,
          speechDetected: false,
          interrupting: false,
        },
        'cancel-reply',
        'submit-turn',
      );
    }
  }
  if (event.type === 'idle-timeout' && state.mode === 'conversation') {
    if (state.phase === 'listening' && !state.speechDetected) return result(idle(), 'cancel-all');
  }
  if (event.type === 'reply-started' && state.phase === 'processing') {
    return result({ ...state, phase: 'speaking' });
  }
  if (event.type === 'reply-quiet' && state.phase === 'speaking') {
    return result({ ...state, phase: 'processing' });
  }
  if (event.type === 'reply-ended' && talking) {
    if (state.mode === 'conversation') {
      // Listening again on the same open microphone; words already under way still count.
      return result({ ...state, phase: 'listening', interrupting: false });
    }
    return result(idle());
  }
  return result(state);
}
