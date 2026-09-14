import type { DesktopBridge, SpeechCue } from '@edi/contracts';
import { decodeRecording } from './DecodeRecording';
import { openMicrophone, type CapturedTurn } from './MicrophoneCapture';
import { PcmPlayer } from './PcmPlayer';

/** Speech is assumed once the input level stays above this RMS for a few meter frames. */
const SPEECH_RMS = 0.02;
const SPEECH_FRAMES = 3;
const METER_MS = 50;
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
  abort: AbortController;
  turn?: CapturedTurn;
  stopMeter?: () => void;
}

/**
 * The pet window's half of a voice turn. Main decides when to open, finish or
 * cancel; this owns the microphone, decodes the recording to 16 kHz PCM16, and
 * plays spoken replies. Everything is tagged with main's session generation.
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
  let playback: { generation: number; token: number | null } | undefined;
  // A `next` cue waits for its audio chunk to be scheduled; timers fire as that audio plays.
  let pendingCue: { generation: number; cue: SpeechCue } | undefined;
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

  const report = (generation: number, event: 'capture-ready' | 'speech-detected' | 'failed') =>
    void bridge.command({ type: 'voice-event', generation, event }).catch(() => {});

  function cancelCapture() {
    capture?.stopMeter?.();
    capture?.turn?.cancel();
    capture?.abort.abort();
    capture = undefined;
  }

  async function open(generation: number) {
    cancelCapture();
    const current: Capture = { generation, abort: new AbortController() };
    capture = current;
    try {
      const turn = await openMicrophone(current.abort.signal, {
        getUserMedia: constraints => navigator.mediaDevices.getUserMedia(constraints),
        createRecorder: stream => {
          current.stopMeter = meter(stream, () => report(generation, 'speech-detected'));
          return new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
        },
      });
      if (capture !== current) return turn.cancel();
      current.turn = turn;
      report(generation, 'capture-ready');
    } catch {
      if (capture !== current) return;
      cancelCapture();
      report(generation, 'failed');
    }
  }

  async function finish(generation: number) {
    const current = capture;
    if (!current || current.generation !== generation || !current.turn) return;
    current.stopMeter?.();
    current.turn.finish();
    try {
      const recording = await current.turn.result;
      if (!recording) return;
      const pcm = await decodeRecording(recording, current.abort.signal);
      if (capture === current) await bridge.command({ type: 'voice-audio', generation, pcm });
    } catch {
      if (capture === current) report(generation, 'failed');
    } finally {
      if (capture === current) capture = undefined;
    }
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
  async function play(generation: number, samples: Float32Array, rate: number) {
    if (!player) {
      const context = new AudioContext();
      output = context.createAnalyser();
      output.fftSize = 512;
      output.connect(context.destination);
      // A long queue lets Chatterbox synthesize the next sentence while this one plays.
      player = new PcmPlayer(context, output, SPEECH_QUEUE_SECONDS);
    }
    if (playback?.generation !== generation) {
      playback = { generation, token: null };
      const token = await player.begin();
      if (playback?.generation !== generation) return;
      playback.token = token;
    }
    const token = playback.token;
    if (token === null) return;
    for (let attempt = 0; attempt < RETRY_LIMIT; attempt++) {
      const result = player.push(token, samples, rate);
      if (result === 'stale') return;
      if (result === 'accepted') {
        if (pendingCue?.generation === generation) {
          performIn(player.timing().untilLastStart, pendingCue.cue);
          pendingCue = undefined;
        }
        followSpeech();
        await bridge.command({ type: 'voice-played', generation }).catch(() => {});
        return;
      }
      await new Promise(resolve => setTimeout(resolve, RETRY_MS));
    }
  }

  const unsubscribe = bridge.onVoice(event => {
    if (event.type === 'open') void open(event.generation);
    else if (event.type === 'finish') void finish(event.generation);
    else if (event.type === 'cancel' && capture?.generation === event.generation) cancelCapture();
    else if (event.type === 'pcm')
      void play(event.generation, event.samples, event.rate).catch(() => {});
    else if (event.type === 'cue') {
      if (event.at === 'next') pendingCue = { generation: event.generation, cue: event.cue };
      else if (player && playback?.generation === event.generation)
        // The tag's sound closes the clip: start slightly before the queued audio ends.
        performIn(Math.max(0, player.timing().untilEnd - CUE_END_LEAD[event.cue]), event.cue);
    } else if (event.type === 'stop-audio') {
      player?.stop();
      playback = undefined;
      clearCues();
      stopFollowing();
    }
  });

  return () => {
    unsubscribe();
    clearCues();
    stopFollowing();
    cancelCapture();
    void player?.dispose();
  };
}

/**
 * Rough speech detection from the input level, so an empty hold submits nothing.
 * Whisper's own voice-activity model still decides what was actually said.
 */
function meter(stream: MediaStream, onSpeech: () => void) {
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  let loud = 0;
  let heard = false;
  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const value of samples) sum += value * value;
    loud = Math.sqrt(sum / samples.length) > SPEECH_RMS ? loud + 1 : 0;
    if (!heard && loud >= SPEECH_FRAMES) {
      heard = true;
      onSpeech();
    }
  }, METER_MS);
  return () => {
    clearInterval(timer);
    source.disconnect();
    void context.close();
  };
}
