import { SpeechActivity, type DesktopBridge, type SpeechCue, type VoiceMode } from '@edi/contracts';
import { FRAME_MS, FRAME_SAMPLES, openPcmCapture, type PcmCapture } from './PcmCapture';
import { PcmPlayer } from './PcmPlayer';

/** Audio still captured after push-to-talk is released, so the last word is not clipped. */
const RELEASE_TAIL_MS = 200;
/** Microphone audio goes to main in chunks of this many 20 ms frames. */
const CHUNK_FRAMES = 5;
/** Audio kept from just before speech is detected, so the first word is not clipped. */
const PREROLL_FRAMES = 20;
/** A local pause on barge-in lifts itself if main does not confirm a reply is being talked over. */
const BARGE_CONFIRM_MS = 600;
/** Backpressure: retry an unaccepted chunk this often, for at most this long. */
const RETRY_MS = 100;
const RETRY_LIMIT = 60;
/** Speech that may wait ahead of the playhead (about 3 MB of samples at 24 kHz). */
const SPEECH_QUEUE_SECONDS = 30;
/** Output loudness that counts as a fully open mouth, and how quickly the mouth follows. */
const MOUTH_FULL_RMS = 0.16;
const MOUTH_ATTACK = 0.55;
const MOUTH_RELEASE = 0.22;
/** Silence after the last queued chunk before the mouth hands back to the expression. */
const MOUTH_IDLE_MS = 300;
/** A tag that ends a clip sounds over roughly its last this-many seconds of audio. */
const CUE_END_LEAD: Record<SpeechCue, number> = {
  laugh: 1.2,
  chuckle: 0.8,
  sigh: 1.1,
  gasp: 0.6,
  groan: 1,
  sniff: 0.5,
};

interface Capture {
  generation: number;
  mode: VoiceMode;
  abort: AbortController;
  capture?: PcmCapture;
  activity: SpeechActivity;
  /** Sending the current utterance to main (push-to-talk: the whole hold). */
  streaming: boolean;
  preroll: Int16Array[];
  outgoing: Int16Array[];
}

/**
 * The pet window's half of voice. Main decides when to open, finish or cancel and owns the
 * turn; this owns the microphone and speaker. It streams 16 kHz PCM to main while someone
 * speaks, reports speech starting and pausing, and pauses Edi's audio the instant someone
 * talks over her in a hands-free conversation. Everything is tagged with main's generation.
 */
export function startVoiceClient(
  bridge: DesktopBridge,
  options: {
    /** 0–1 loudness of Edi's own speech while it plays; null when playback ends. */
    onSpeechLevel?: (level: number | null) => void;
    /** A laugh or chuckle is audible now: perform it. */
    onCue?: (cue: SpeechCue) => void;
  } = {},
): () => void {
  let capture: Capture | undefined;
  let player: PcmPlayer | undefined;
  let output: AnalyserNode | undefined;
  let mouthFrame = 0;
  let playback: { key: string; token: number | null } | undefined;
  let bargeTimer: ReturnType<typeof setTimeout> | undefined;
  // A `next` cue waits for its audio chunk to be scheduled; timers fire as that audio plays.
  let pendingCue: { key: string; cue: SpeechCue } | undefined;
  const cueTimers = new Set<ReturnType<typeof setTimeout>>();

  function performIn(seconds: number, cue: SpeechCue) {
    const timer = setTimeout(() => {
      cueTimers.delete(timer);
      options.onCue?.(cue);
    }, seconds * 1000);
    cueTimers.add(timer);
  }

  function clearCues() {
    pendingCue = undefined;
    for (const timer of cueTimers) clearTimeout(timer);
    cueTimers.clear();
  }

  const report = (
    generation: number,
    event: 'capture-ready' | 'speech-detected' | 'pause' | 'long-pause' | 'captured' | 'failed',
  ) => void bridge.command({ type: 'voice-event', generation, event }).catch(() => {});

  function sendChunk(current: Capture, frames: Int16Array[]) {
    if (!frames.length) return;
    const pcm = new Uint8Array(frames.length * FRAME_SAMPLES * 2);
    frames.forEach((frame, index) =>
      pcm.set(
        new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength),
        index * FRAME_SAMPLES * 2,
      ),
    );
    void bridge.command({ type: 'voice-pcm', generation: current.generation, pcm }).catch(() => {});
  }

  function flush(current: Capture) {
    sendChunk(current, current.outgoing.splice(0));
  }

  /** Edi's voice is audible right now (queued audio that is not held). */
  const edisSpeaking = () => Boolean(player && !player.paused && player.snapshot().pendingNodes);

  function onFrame(current: Capture, frame: Int16Array, rms: number) {
    if (capture !== current) return;
    const speaking = edisSpeaking();
    for (const event of current.activity.frame(rms, FRAME_MS, speaking)) {
      if (event === 'speech') {
        if (current.mode === 'conversation') {
          // Barge-in: silence Edi now, before main has even heard about it.
          if (speaking) {
            player?.pause();
            clearTimeout(bargeTimer);
            bargeTimer = setTimeout(() => player?.resume(), BARGE_CONFIRM_MS);
          }
          report(current.generation, 'speech-detected');
          if (!current.streaming) {
            current.streaming = true;
            sendChunk(current, current.preroll.splice(0));
          }
        } else report(current.generation, 'speech-detected');
      } else if (current.mode === 'conversation') report(current.generation, event);
    }
    if (current.streaming) {
      current.outgoing.push(frame);
      if (current.outgoing.length >= CHUNK_FRAMES) flush(current);
    } else {
      current.preroll.push(frame);
      if (current.preroll.length > PREROLL_FRAMES) current.preroll.shift();
    }
  }

  function cancelCapture() {
    capture?.capture?.stop();
    capture?.abort.abort();
    capture = undefined;
  }

  async function open(generation: number, mode: VoiceMode) {
    cancelCapture();
    const current: Capture = {
      generation,
      mode,
      abort: new AbortController(),
      activity: new SpeechActivity(),
      // Push-to-talk sends everything from the moment the microphone opens.
      streaming: mode === 'push-to-talk',
      preroll: [],
      outgoing: [],
    };
    capture = current;
    try {
      const opened = await openPcmCapture(
        current.abort.signal,
        (frame, rms) => onFrame(current, frame, rms),
        () => {
          if (capture !== current) return;
          capture = undefined;
          report(generation, 'failed');
        },
      );
      if (capture !== current) return opened.stop();
      current.capture = opened;
      report(generation, 'capture-ready');
    } catch {
      if (capture !== current) return;
      cancelCapture();
      report(generation, 'failed');
    }
  }

  /**
   * Push-to-talk released: keep listening a moment (people let go while finishing the last
   * word), then release the microphone, send what is left, and say so.
   */
  function finish(generation: number) {
    const current = capture;
    if (!current || current.generation !== generation) return;
    setTimeout(() => {
      if (capture !== current) return;
      current.capture?.stop();
      capture = undefined;
      flush(current);
      report(generation, 'captured');
    }, RELEASE_TAIL_MS);
  }

  /** Follows the loudness of what is actually playing, so the mouth moves with the words. */
  function followSpeech() {
    if (mouthFrame || !output || !options.onSpeechLevel) return;
    const analyser = output;
    const emit = options.onSpeechLevel;
    const samples = new Float32Array(analyser.fftSize);
    let level = 0;
    let quietSince = performance.now();
    const tick = (now: number) => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const value of samples) sum += value * value;
      const target = Math.min(1, Math.sqrt(sum / samples.length) / MOUTH_FULL_RMS);
      level += (target - level) * (target > level ? MOUTH_ATTACK : MOUTH_RELEASE);
      emit(Math.round(level * 100) / 100);
      if (player?.snapshot().pendingNodes) quietSince = now;
      if (now - quietSince > MOUTH_IDLE_MS) return stopFollowing();
      mouthFrame = requestAnimationFrame(tick);
    };
    mouthFrame = requestAnimationFrame(tick);
  }

  function stopFollowing() {
    cancelAnimationFrame(mouthFrame);
    mouthFrame = 0;
    options.onSpeechLevel?.(null);
  }

  // Main sends one chunk at a time and waits for `voice-played`, so this never overlaps.
  async function play(generation: number, turn: number, samples: Float32Array, rate: number) {
    if (!player) {
      const context = new AudioContext();
      output = context.createAnalyser();
      output.fftSize = 512;
      output.connect(context.destination);
      // A long queue lets Chatterbox synthesize the next sentence while this one plays.
      player = new PcmPlayer(context, output, SPEECH_QUEUE_SECONDS);
    }
    const key = `${generation}:${turn}`;
    if (playback?.key !== key) {
      playback = { key, token: null };
      const token = await player.begin();
      if (playback?.key !== key) return;
      playback.token = token;
    }
    const token = playback.token;
    if (token === null) return;
    for (let attempt = 0; attempt < RETRY_LIMIT; attempt++) {
      const result = player.push(token, samples, rate);
      if (result === 'stale') return;
      if (result === 'accepted') {
        if (pendingCue?.key === key) {
          performIn(player.timing().untilLastStart, pendingCue.cue);
          pendingCue = undefined;
        }
        followSpeech();
        await bridge.command({ type: 'voice-played', generation, turn }).catch(() => {});
        return;
      }
      // Held while someone talks over Edi: wait as long as that takes.
      if (player.paused) attempt--;
      await new Promise(resolve => setTimeout(resolve, RETRY_MS));
    }
  }

  const unsubscribe = bridge.onVoice(event => {
    if (event.type === 'open') void open(event.generation, event.mode);
    else if (event.type === 'finish') finish(event.generation);
    else if (event.type === 'cancel' && capture?.generation === event.generation) cancelCapture();
    else if (event.type === 'converse' && capture?.generation === event.generation) {
      capture.mode = 'conversation';
      capture.streaming = false;
      capture.outgoing = [];
      capture.activity.reset();
    } else if (event.type === 'utterance-done' && capture?.generation === event.generation) {
      capture.streaming = false;
      capture.outgoing = [];
      capture.preroll = [];
      capture.activity.reset();
    } else if (event.type === 'pcm')
      void play(event.generation, event.turn, event.samples, event.rate).catch(() => {});
    else if (event.type === 'cue') {
      const key = `${event.generation}:${event.turn}`;
      if (event.at === 'next') pendingCue = { key, cue: event.cue };
      else if (player && playback?.key === key)
        // The tag's sound closes the clip: start slightly before the queued audio ends.
        performIn(Math.max(0, player.timing().untilEnd - CUE_END_LEAD[event.cue]), event.cue);
    } else if (event.type === 'pause-audio') {
      // Main confirmed the person is talking over a reply: hold until their words are in.
      clearTimeout(bargeTimer);
      player?.pause();
    } else if (event.type === 'resume-audio') {
      clearTimeout(bargeTimer);
      player?.resume();
    } else if (event.type === 'stop-audio') {
      clearTimeout(bargeTimer);
      player?.stop();
      playback = undefined;
      clearCues();
      stopFollowing();
    }
  });

  return () => {
    unsubscribe();
    clearTimeout(bargeTimer);
    clearCues();
    stopFollowing();
    cancelCapture();
    void player?.dispose();
  };
}
