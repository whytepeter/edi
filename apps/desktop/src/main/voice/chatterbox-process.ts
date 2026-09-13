import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

export interface ChatterboxRuntime {
  python: string;
  worker: string;
  cache: string;
  model: string;
}

type Consume = (pcm: Float32Array, sampleRate: number) => Promise<void>;
const SAMPLE_RATE = 24_000;
const MAX_LINE = 140_000;
const MAX_FRAME_BYTES = 96_000;
const MAX_SECONDS = 180;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

class ChatterboxWorker {
  private readonly child: ChildProcessByStdio<Writable, Readable, null>;
  private readonly lines: string[] = [];
  private buffer = '';
  private waiter?: { resolve(line: string): void; reject(error: Error): void };
  private failure?: Error;

  constructor(runtime: ChatterboxRuntime) {
    this.child = spawn(runtime.python, ['-u', runtime.worker, '--model', runtime.model], {
      stdio: ['pipe', 'pipe', 'ignore'],
      env: {
        PATH: '/usr/bin:/bin',
        HF_HOME: runtime.cache,
        HF_HUB_OFFLINE: '1',
        TRANSFORMERS_OFFLINE: '1',
        HF_HUB_DISABLE_TELEMETRY: '1',
        // TTS tolerates the relaxed Metal math mode and benefits from lower MPS latency.
        PYTORCH_MPS_FAST_MATH: '1',
      },
    });
    this.child.once('close', () => this.fail('Chatterbox Turbo ended unexpectedly'));
    this.child.once('error', () => this.fail('Chatterbox Turbo could not start'));
    this.child.stdin.on('error', () => this.fail('Chatterbox Turbo input closed unexpectedly'));
    this.child.stdout.on('data', (bytes: Buffer) => {
      this.buffer += bytes.toString('utf8');
      if (this.buffer.length > MAX_LINE) return this.kill('Chatterbox Turbo frame too large');
      let end: number;
      while ((end = this.buffer.indexOf('\n')) !== -1) {
        this.lines.push(this.buffer.slice(0, end));
        this.buffer = this.buffer.slice(end + 1);
      }
      this.wake();
    });
  }

  get alive() {
    return !this.failure;
  }

  next(): Promise<Record<string, unknown>> {
    return new Promise<string>((resolve, reject) => {
      this.waiter = { resolve, reject };
      this.wake();
    }).then(line => {
      const value: unknown = JSON.parse(line);
      if (!value || typeof value !== 'object') throw new Error('Invalid Chatterbox Turbo frame');
      return value as Record<string, unknown>;
    });
  }

  write(value: string) {
    if (this.alive) this.child.stdin.write(`${value}\n`);
  }

  kill(message = 'Chatterbox Turbo stopped') {
    this.fail(message);
    if (this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill('SIGTERM');
      setTimeout(() => this.child.kill('SIGKILL'), 1000).unref?.();
    }
  }

  private fail(message: string) {
    this.failure ??= new Error(message);
    this.wake();
  }

  private wake() {
    if (!this.waiter) return;
    const waiter = this.waiter;
    if (this.lines.length) {
      this.waiter = undefined;
      waiter.resolve(this.lines.shift()!);
    } else if (this.failure) {
      this.waiter = undefined;
      waiter.reject(this.failure);
    }
  }
}

function decode(frame: Record<string, unknown>) {
  const { rate, data } = frame;
  if (rate !== SAMPLE_RATE || typeof data !== 'string' || !BASE64.test(data)) {
    throw new Error('Invalid Chatterbox Turbo frame');
  }
  const raw = Buffer.from(data, 'base64');
  if (!raw.length || raw.length % 4 || raw.length > MAX_FRAME_BYTES) {
    throw new Error('Invalid Chatterbox Turbo PCM');
  }
  const pcm = new Float32Array(raw.length / 4);
  for (let index = 0; index < pcm.length; index++) {
    const value = raw.readFloatLE(index * 4);
    if (!Number.isFinite(value) || Math.abs(value) > 1) {
      throw new Error('Invalid Chatterbox Turbo PCM');
    }
    pcm[index] = value;
  }
  return pcm;
}

function deadline(ms: number, message: string) {
  let timer: ReturnType<typeof setTimeout>;
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  void promise.catch(() => {});
  return { promise, clear: () => clearTimeout(timer) };
}

export type ChatterboxStatus = 'off' | 'loading' | 'ready';

/**
 * Warm, bounded Chatterbox Turbo supervisor. Loading can take minutes on a busy Mac, so it
 * has its own generous deadline. Stop cancels at the next audio frame and keeps the model
 * loaded; only a worker that stops answering is killed.
 */
export class ChatterboxVoice {
  private process?: ChatterboxWorker;
  private ready?: Promise<ChatterboxWorker>;
  private queue: Promise<unknown> = Promise.resolve();
  private idleTimer?: ReturnType<typeof setTimeout>;
  private loaded = false;
  /** Generation time divided by audio length for the last finished reply; above 1 is slower than speech. */
  lastRealTimeFactor: number | null = null;
  /** Time from handing text to the warm worker until its first playable PCM frame. */
  lastFirstAudioMs: number | null = null;

  constructor(
    private readonly runtime: ChatterboxRuntime,
    private readonly options: { idleMs?: number; readyMs?: number; cancelGraceMs?: number } = {},
  ) {}

  get status(): ChatterboxStatus {
    if (!this.process?.alive) return 'off';
    return this.loaded ? 'ready' : 'loading';
  }

  warm() {
    clearTimeout(this.idleTimer);
    void this.ensure().then(
      () => this.scheduleIdle(),
      () => {},
    );
  }

  speak(text: string, signal: AbortSignal, consume: Consume, timeoutMs = 180_000) {
    if (!text.trim() || text.length > 2_000) {
      return Promise.reject(new Error('Voice text must be 1–2000 characters'));
    }
    const result = this.queue.then(() => this.utter(text, signal, consume, timeoutMs));
    this.queue = result.catch(() => {});
    return result;
  }

  dispose() {
    clearTimeout(this.idleTimer);
    this.process?.kill();
    this.process = undefined;
    this.ready = undefined;
    this.loaded = false;
  }

  private ensure() {
    if (this.ready && this.process?.alive) return this.ready;
    const process = new ChatterboxWorker(this.runtime);
    this.process = process;
    this.loaded = false;
    const timeout = deadline(
      this.options.readyMs ?? 10 * 60_000,
      'Chatterbox Turbo took too long to load',
    );
    this.ready = Promise.race([process.next(), timeout.promise])
      .then(frame => {
        if (frame.type !== 'ready' || frame.rate !== SAMPLE_RATE || frame.model !== 'turbo') {
          throw new Error('Invalid Chatterbox Turbo frame');
        }
        if (this.process === process) this.loaded = true;
        return process;
      })
      .catch((error: unknown) => {
        process.kill();
        throw error;
      })
      .finally(timeout.clear);
    return this.ready;
  }

  private async utter(text: string, signal: AbortSignal, consume: Consume, timeoutMs: number) {
    signal.throwIfAborted();
    clearTimeout(this.idleTimer);
    const aborted = new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('Chatterbox Turbo cancelled')), {
        once: true,
      });
    });
    void aborted.catch(() => {});
    let process: ChatterboxWorker | undefined;
    let clean = false;
    let awaitingCredit = false;
    // The reply deadline starts once the model is loaded; loading has its own.
    let timeout: ReturnType<typeof deadline> | undefined;
    const race = <T>(work: Promise<T>) =>
      Promise.race(timeout ? [work, timeout.promise, aborted] : [work, aborted]);
    let samples = 0;
    try {
      process = await race(this.ensure());
      timeout = deadline(timeoutMs, 'Chatterbox Turbo timed out');
      const started = Date.now();
      process.write(JSON.stringify({ text }));
      for (;;) {
        const frame = await race(process.next());
        if (frame.type === 'done') {
          if (!samples) throw new Error('Chatterbox Turbo returned no audio');
          this.lastRealTimeFactor = (Date.now() - started) / 1000 / (samples / SAMPLE_RATE);
          clean = true;
          return;
        }
        if (frame.type !== 'pcm') throw new Error('Invalid Chatterbox Turbo frame');
        awaitingCredit = true;
        const pcm = decode(frame);
        if (!samples) this.lastFirstAudioMs = Date.now() - started;
        samples += pcm.length;
        if (samples > SAMPLE_RATE * MAX_SECONDS) {
          throw new Error('Chatterbox Turbo output limit reached');
        }
        await race(consume(pcm, SAMPLE_RATE));
        process.write('ack');
        awaitingCredit = false;
      }
    } catch (error) {
      // Stop: the sentence being generated may take a while, but reloading takes far longer.
      if (process?.alive && signal.aborted)
        clean = await this.drainCancelled(process, awaitingCredit);
      throw error;
    } finally {
      timeout?.clear();
      if (!clean && process === this.process) this.dispose();
      this.scheduleIdle();
    }
  }

  /** Answer every pending frame with `cancel` until the worker reports it has stopped. */
  private async drainCancelled(process: ChatterboxWorker, awaitingCredit: boolean) {
    const grace = deadline(this.options.cancelGraceMs ?? 90_000, 'Chatterbox Turbo did not stop');
    try {
      if (awaitingCredit) process.write('cancel');
      for (;;) {
        const frame = await Promise.race([process.next(), grace.promise]);
        if (frame.type === 'done') return true;
        process.write('cancel');
      }
    } catch {
      return false;
    } finally {
      grace.clear();
    }
  }

  private scheduleIdle() {
    clearTimeout(this.idleTimer);
    if (!this.process) return;
    this.idleTimer = setTimeout(() => this.dispose(), this.options.idleMs ?? 15 * 60_000);
    this.idleTimer.unref?.();
  }
}
