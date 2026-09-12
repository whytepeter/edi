import type { DesktopBridge } from '@edi/contracts';
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
export function startVoiceClient(bridge: DesktopBridge): () => void {
  let capture: Capture | undefined;
  let player: PcmPlayer | undefined;
  let playback: { generation: number; token: number | null } | undefined;

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

  // Main sends one chunk at a time and waits for `voice-played`, so this never overlaps.
  async function play(generation: number, samples: Float32Array, rate: number) {
    player ??= new PcmPlayer(new AudioContext());
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
    else if (event.type === 'stop-audio') {
      player?.stop();
      playback = undefined;
    }
  });

  return () => {
    unsubscribe();
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
