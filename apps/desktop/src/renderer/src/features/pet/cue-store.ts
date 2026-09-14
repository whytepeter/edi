import type { SpeechCue } from '@edi/contracts';

/** How long each cue's face and motion last, roughly the length of the sound. */
const CUE_MS: Record<SpeechCue, number> = {
  laugh: 1400,
  chuckle: 900,
  sigh: 1300,
  gasp: 700,
  groan: 1100,
  sniff: 600,
};

let current: SpeechCue | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());

/**
 * The cue playing right now in the pet window. The voice client calls `playCue` as the sound
 * starts; the character reads it with useSyncExternalStore. A newer cue replaces the old one.
 */
export const cueStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  current: () => current,
  play(cue: SpeechCue) {
    clearTimeout(timer);
    current = null;
    notify();
    // A frame apart, so the same cue twice restarts its animation.
    requestAnimationFrame(() => {
      current = cue;
      notify();
      timer = setTimeout(() => {
        current = null;
        notify();
      }, CUE_MS[cue]);
    });
  },
};
