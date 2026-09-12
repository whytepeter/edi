/** Pure session policy. Capture, VAD, transcription and playback execute the effects. */
export type VoiceMode = 'push-to-talk' | 'conversation';
export interface VoiceSession {
  generation: number;
  mode: VoiceMode | null;
  phase: 'idle' | 'opening' | 'listening' | 'processing' | 'speaking' | 'error';
  speechDetected: boolean;
}
export type VoiceEffect = 'cancel-all' | 'open-microphone' | 'close-microphone' | 'submit-turn';
export type VoiceEvent =
  | { type: 'start'; mode: VoiceMode }
  | { type: 'stop' }
  | {
      type:
        | 'capture-ready'
        | 'speech-detected'
        | 'silence'
        | 'release'
        | 'reply-started'
        | 'reply-ended'
        | 'failed';
      generation: number;
    };

export const initialVoiceSession: VoiceSession = {
  generation: 0,
  mode: null,
  phase: 'idle',
  speechDetected: false,
};

export function transitionVoice(
  state: VoiceSession,
  event: VoiceEvent,
): {
  state: VoiceSession;
  effects: VoiceEffect[];
} {
  const result = (next: VoiceSession, ...effects: VoiceEffect[]) => ({ state: next, effects });
  if (event.type === 'stop') {
    return result({ ...initialVoiceSession, generation: state.generation + 1 }, 'cancel-all');
  }
  if (event.type === 'start') {
    return result(
      {
        generation: state.generation + 1,
        mode: event.mode,
        phase: 'opening',
        speechDetected: false,
      },
      'cancel-all',
      'open-microphone',
    );
  }
  // A completed turn gets a fresh generation too: late VAD/worker events cannot
  // submit audio or change the bubble for a newer turn in the same conversation.
  if (event.generation !== state.generation || state.mode === null) return result(state);
  if (event.type === 'failed') {
    return result(
      { ...state, generation: state.generation + 1, phase: 'error', mode: null },
      'cancel-all',
    );
  }
  if (event.type === 'capture-ready' && state.phase === 'opening') {
    return result({ ...state, phase: 'listening' });
  }
  if (event.type === 'speech-detected' && state.phase === 'listening') {
    return result({ ...state, speechDetected: true });
  }
  if (event.type === 'release' && state.mode === 'push-to-talk' && state.phase === 'opening') {
    return result({ ...initialVoiceSession, generation: state.generation + 1 }, 'cancel-all');
  }
  const submit =
    (event.type === 'release' && state.mode === 'push-to-talk') ||
    (event.type === 'silence' && state.mode === 'conversation' && state.speechDetected);
  if (submit && state.phase === 'listening') {
    if (!state.speechDetected) {
      return result({ ...initialVoiceSession, generation: state.generation + 1 }, 'cancel-all');
    }
    return result({ ...state, phase: 'processing' }, 'close-microphone', 'submit-turn');
  }
  if (event.type === 'reply-started' && state.phase === 'processing') {
    return result({ ...state, phase: 'speaking' });
  }
  if (
    event.type === 'reply-ended' &&
    (state.phase === 'processing' || state.phase === 'speaking')
  ) {
    if (state.mode === 'conversation') {
      return result(
        { ...state, generation: state.generation + 1, phase: 'opening', speechDetected: false },
        'open-microphone',
      );
    }
    return result({ ...initialVoiceSession, generation: state.generation + 1 });
  }
  return result(state);
}
