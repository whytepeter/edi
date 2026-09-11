export interface CaptureDependencies {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  createRecorder(stream: MediaStream): MediaRecorder;
}

export interface CapturedTurn {
  /** In-memory encoded audio, or null for a discarded turn. No file or network writes. */
  result: Promise<Blob | null>;
  finish(): void;
  cancel(): void;
}

const defaults: CaptureDependencies = {
  getUserMedia: constraints => navigator.mediaDevices.getUserMedia(constraints),
  createRecorder: stream => new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' }),
};
const abortError = () => new DOMException('Microphone capture cancelled', 'AbortError');
const stopTracks = (stream: MediaStream) => stream.getTracks().forEach(track => track.stop());

/** Permission can outlive a user gesture. A late grant must release its tracks immediately. */
async function acquire(
  signal: AbortSignal,
  dependencies: CaptureDependencies,
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
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
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

/** One bounded recording. Resolve only after the recorder confirms capture has started. */
export async function openMicrophone(
  signal: AbortSignal,
  dependencies: CaptureDependencies = defaults,
): Promise<CapturedTurn> {
  const stream = await acquire(signal, dependencies);
  if (signal.aborted) {
    stopTracks(stream);
    throw abortError();
  }
  let recorder: MediaRecorder;
  try {
    if (!stream.getAudioTracks().some(track => track.readyState === 'live'))
      throw new Error('No live microphone track');
    recorder = dependencies.createRecorder(stream);
  } catch (error) {
    stopTracks(stream);
    throw error;
  }

  let chunks: Blob[] = [];
  let bytes = 0;
  let finishing = false;
  let settled = false;
  let started = false;
  let resolveResult!: (value: Blob | null) => void;
  let rejectResult!: (error: Error) => void;
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const result = new Promise<Blob | null>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  // Errors can precede the caller receiving the turn; retain the rejection for its await.
  void result.catch(() => {});
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const tracks = stream.getTracks();
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => {
    clearTimeout(durationTimer);
    clearTimeout(startTimer);
    clearTimeout(flushTimer);
    signal.removeEventListener('abort', cancel);
    tracks.forEach(track => track.removeEventListener('ended', deviceLost));
    recorder.ondataavailable = null;
    recorder.onstop = null;
    recorder.onerror = null;
    recorder.onstart = null;
    stopTracks(stream);
  };
  const settle = (error?: Error, discard = false) => {
    if (settled) return;
    settled = true;
    const blob = !error && !discard && bytes ? new Blob(chunks, { type: recorder.mimeType }) : null;
    chunks = [];
    cleanup();
    if (recorder.state !== 'inactive') recorder.stop();
    if (!started) rejectReady(error ?? abortError());
    if (error) rejectResult(error);
    else resolveResult(blob);
  };
  const cancel = () => settle(undefined, true);
  const deviceLost = () => {
    if (!finishing) settle(new Error('Microphone disconnected'));
  };
  const durationTimer = setTimeout(
    () => settle(new Error('Recording exceeded 60 seconds')),
    60_000,
  );
  const startTimer = setTimeout(() => settle(new Error('Microphone did not start')), 5000);
  signal.addEventListener('abort', cancel, { once: true });
  tracks.forEach(track => track.addEventListener('ended', deviceLost));
  recorder.onstart = () => {
    started = true;
    clearTimeout(startTimer);
    resolveReady();
  };
  recorder.ondataavailable = event => {
    if (settled || !event.data.size) return;
    bytes += event.data.size;
    if (bytes > 8 * 1024 * 1024 || chunks.length >= 512) {
      settle(new Error('Recording size limit exceeded'));
      return;
    }
    chunks.push(event.data);
  };
  recorder.onerror = () => settle(new Error('Microphone recording failed'));
  recorder.onstop = () =>
    finishing ? settle() : settle(new Error('Microphone stopped unexpectedly'));
  try {
    if (signal.aborted) cancel();
    else recorder.start(250);
  } catch {
    settle(new Error('Microphone recording could not start'));
  }
  await ready;
  return {
    result,
    cancel,
    finish() {
      if (settled || finishing) return;
      finishing = true;
      // Release the hardware now, while the encoder asynchronously flushes its last chunk.
      stopTracks(stream);
      flushTimer = setTimeout(() => settle(new Error('Microphone flush timed out')), 2000);
      if (recorder.state !== 'inactive') recorder.stop();
    },
  };
}
