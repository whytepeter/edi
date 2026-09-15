export interface PcmCaptureDependencies {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  createContext(): AudioContext;
}

export interface PcmCapture {
  /** Release the microphone at once. */
  stop(): void;
}

/** 20 ms frames at 16 kHz: what turn detection measures and what main transcribes. */
export const CAPTURE_RATE = 16_000;
export const FRAME_SAMPLES = 320;
export const FRAME_MS = 20;

const defaults: PcmCaptureDependencies = {
  getUserMedia: constraints => navigator.mediaDevices.getUserMedia(constraints),
  // At 16 kHz Chromium resamples the microphone with a proper filter. Linear downsampling from
  // 48 kHz added about half a point of word error rate in a like-for-like test.
  createContext: () => new AudioContext({ sampleRate: CAPTURE_RATE }),
};
const abortError = () => new DOMException('Microphone capture cancelled', 'AbortError');
const stopTracks = (stream: MediaStream) => stream.getTracks().forEach(track => track.stop());

/** Permission can outlive a user gesture. A late grant must release its tracks immediately. */
async function acquire(
  signal: AbortSignal,
  dependencies: PcmCaptureDependencies,
): Promise<MediaStream> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const abort = () => fail(abortError());
    const timer = setTimeout(() => fail(new Error('Microphone permission timed out')), 30_000);
    signal.addEventListener('abort', abort, { once: true });
    void Promise.resolve()
      .then(() =>
        dependencies.getUserMedia({
          // Echo cancellation lets the microphone stay open while Edi speaks.
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        }),
      )
      .then(stream => {
        if (settled || signal.aborted) {
          stopTracks(stream);
          fail(abortError());
          return;
        }
        settled = true;
        cleanup();
        resolve(stream);
      }, fail);
  });
}

/**
 * Fallback when the context cannot run at 16 kHz: converts the device rate with linear interpolation, keeping its position across
 * buffers, and emits fixed 20 ms frames with their loudness.
 */
export class Resampler {
  private position = 0;
  private previous = 0;
  private frame = new Int16Array(FRAME_SAMPLES);
  private filled = 0;
  private energy = 0;
  private readonly step: number;

  constructor(inputRate: number) {
    this.step = inputRate / CAPTURE_RATE;
  }

  push(input: Float32Array, emit: (pcm: Int16Array, rms: number) => void) {
    // `position` is measured from the sample before this buffer (index -1 is `previous`).
    while (this.position < input.length) {
      const index = Math.floor(this.position);
      const fraction = this.position - index;
      const before = index === 0 ? this.previous : (input[index - 1] ?? 0);
      const after = input[index] ?? 0;
      const sample = Math.max(-1, Math.min(1, before + (after - before) * fraction));
      this.frame[this.filled++] = Math.round(sample * 32767);
      this.energy += sample * sample;
      if (this.filled === FRAME_SAMPLES) {
        emit(this.frame, Math.sqrt(this.energy / FRAME_SAMPLES));
        this.frame = new Int16Array(FRAME_SAMPLES);
        this.filled = 0;
        this.energy = 0;
      }
      this.position += this.step;
    }
    this.position -= input.length;
    this.previous = input[input.length - 1] ?? this.previous;
  }
}

/**
 * The microphone as a live stream of 16 kHz PCM16 frames, kept in memory only. A
 * ScriptProcessor keeps this free of worklet modules (the renderer's script policy is
 * 'self'-only); its buffer is small enough for turn detection.
 */
export async function openPcmCapture(
  signal: AbortSignal,
  onFrame: (pcm: Int16Array, rms: number) => void,
  onLost: () => void,
  dependencies: PcmCaptureDependencies = defaults,
): Promise<PcmCapture> {
  const stream = await acquire(signal, dependencies);
  if (signal.aborted || !stream.getAudioTracks().some(track => track.readyState === 'live')) {
    stopTracks(stream);
    throw signal.aborted ? abortError() : new Error('No live microphone track');
  }
  let context: AudioContext;
  try {
    context = dependencies.createContext();
  } catch (error) {
    stopTracks(stream);
    throw error;
  }
  let stopped = false;
  const tracks = stream.getTracks();
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(1024, 1, 1);
  // A processor only runs while connected to the output; this keeps it silent.
  const mute = context.createGain();
  mute.gain.value = 0;
  const resampler = new Resampler(context.sampleRate);
  processor.onaudioprocess = event => {
    if (!stopped) resampler.push(event.inputBuffer.getChannelData(0), onFrame);
  };
  source.connect(processor);
  processor.connect(mute);
  mute.connect(context.destination);

  const deviceLost = () => {
    if (stopped) return;
    stop();
    onLost();
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    signal.removeEventListener('abort', stop);
    tracks.forEach(track => track.removeEventListener('ended', deviceLost));
    processor.onaudioprocess = null;
    source.disconnect();
    processor.disconnect();
    mute.disconnect();
    stopTracks(stream);
    void context.close().catch(() => {});
  };
  tracks.forEach(track => track.addEventListener('ended', deviceLost));
  signal.addEventListener('abort', stop, { once: true });
  try {
    await context.resume();
  } catch (error) {
    stop();
    throw error;
  }
  if (signal.aborted) {
    stop();
    throw abortError();
  }
  return { stop };
}
