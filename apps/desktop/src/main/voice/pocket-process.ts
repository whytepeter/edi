import { spawn } from 'node:child_process';

export interface PocketRuntime {
  /** Trusted native paths, never values supplied by a renderer. */
  python: string;
  worker: string;
  cache: string;
}

/** One supervised utterance. Awaiting the consumer applies backpressure to inference. */
export async function speakPocket(
  runtime: PocketRuntime,
  text: string,
  signal: AbortSignal,
  consume: (pcm: Float32Array, sampleRate: number) => Promise<void>,
  timeoutMs = 120_000,
): Promise<void> {
  if (!text.trim() || text.length > 2000) throw new Error('Voice text must be 1–2000 characters');
  signal.throwIfAborted();
  const child = spawn(runtime.python, ['-u', runtime.worker], {
    stdio: ['pipe', 'pipe', 'ignore'],
    // Do not inherit provider keys, Python injection variables, or HF credentials.
    env: {
      PATH: '/usr/bin:/bin',
      HF_HOME: runtime.cache,
      HF_HUB_OFFLINE: '1',
      TRANSFORMERS_OFFLINE: '1',
      HF_HUB_DISABLE_TELEMETRY: '1',
    },
  });
  let failure: Error | undefined;
  let rejectFailure!: (error: Error) => void;
  const failed = new Promise<never>((_, reject) => {
    rejectFailure = reject;
  });
  void failed.catch(() => {});
  const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const terminate = () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    killTimer ??= setTimeout(() => child.kill('SIGKILL'), 1000);
  };
  const fail = (message: string) => {
    failure ??= new Error(message);
    rejectFailure(failure);
    terminate();
  };
  child.once('error', () => fail('Local voice process could not start'));
  child.stdin.on('error', () => fail('Local voice input closed unexpectedly'));
  const abort = () => fail('Local voice cancelled');
  signal.addEventListener('abort', abort, { once: true });
  const deadline = setTimeout(() => fail('Local voice timed out'), timeoutMs);
  let buffer = '';
  let done = false;
  let count = 0;
  let samples = 0;
  try {
    if (signal.aborted) abort();
    child.stdin.write(JSON.stringify({ text }) + '\n');
    for await (const bytes of child.stdout) {
      buffer += bytes.toString('utf8');
      if (buffer.length > 140_000) throw new Error('Local voice frame too large');
      let end: number;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        const frame = JSON.parse(line);
        if (done) throw new Error('Local voice sent data after completion');
        if (frame.type === 'done' && count > 0) {
          done = true;
          continue;
        }
        if (
          frame.type !== 'pcm' ||
          frame.rate !== 24000 ||
          typeof frame.data !== 'string' ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(frame.data)
        ) {
          throw new Error('Invalid local voice frame');
        }
        const raw = Buffer.from(frame.data, 'base64');
        if (!raw.length || raw.length % 4 || raw.length > 96000)
          throw new Error('Invalid PCM size');
        const pcm = new Float32Array(raw.length / 4);
        for (let i = 0; i < pcm.length; i++) {
          const value = raw.readFloatLE(i * 4);
          if (!Number.isFinite(value) || Math.abs(value) > 1) throw new Error('Invalid PCM sample');
          pcm[i] = value;
        }
        samples += pcm.length;
        if (++count > 10000 || samples > 24000 * 180)
          throw new Error('Local voice output limit reached');
        await Promise.race([consume(pcm, frame.rate), failed]);
        if (failure) throw failure;
        child.stdin.write('ack\n');
      }
    }
    await closed;
    if (failure) throw failure;
    if (!done || buffer || child.exitCode !== 0) throw new Error('Local voice ended unexpectedly');
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener('abort', abort);
    terminate();
    await closed;
    if (killTimer) clearTimeout(killTimer);
  }
}
