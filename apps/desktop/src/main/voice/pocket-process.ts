import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

export interface PocketRuntime {
  /** Trusted native paths, never values supplied by a renderer. */
  python: string;
  worker: string;
  cache: string;
}

type Consume = (pcm: Float32Array, sampleRate: number) => Promise<void>;

const MAX_LINE = 140_000;
const MAX_FRAME_BYTES = 96_000;
const MAX_FRAMES = 10_000;
const MAX_SECONDS = 180;
const SAMPLE_RATE = 24_000;
/** After Stop, the worker must acknowledge the cancel this quickly or it is killed. */
const CANCEL_GRACE_MS = 2000;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** One Python worker process: bounded line protocol, explicit environment, forced cleanup. */
class WorkerProcess {
  /** stdin: requests and credits; stdout: protocol lines; stderr is discarded. */
  private readonly child: ChildProcessByStdio<Writable, Readable, null>;
  private readonly lines: string[] = [];
  private buffer = '';
  private waiter?: { resolve: (line: string) => void; reject: (error: Error) => void };
  private failure?: Error;
  private killTimer?: ReturnType<typeof setTimeout>;
  readonly closed: Promise<void>;

  constructor(runtime: PocketRuntime) {
    this.child = spawn(runtime.python, ['-u', runtime.worker], {
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
    this.closed = new Promise(resolve => this.child.once('close', () => resolve()));
    this.child.once('close', () => this.fail('Local voice ended unexpectedly'));
    this.child.once('error', () => this.fail('Local voice process could not start'));
    this.child.stdin.on('error', () => this.fail('Local voice input closed unexpectedly'));
    this.child.stdout.on('data', (bytes: Buffer) => {
      this.buffer += bytes.toString('utf8');
      if (this.buffer.length > MAX_LINE) return this.fail('Local voice frame too large');
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

  /** The next protocol line, parsed. Rejects once the process has failed or exited. */
  next(): Promise<Record<string, unknown>> {
    return new Promise<string>((resolve, reject) => {
      this.waiter = { resolve, reject };
      this.wake();
    }).then(line => {
      const value: unknown = JSON.parse(line);
      if (!value || typeof value !== 'object') throw new Error('Invalid local voice frame');
      return value as Record<string, unknown>;
    });
  }

  write(line: string) {
    if (this.alive) this.child.stdin.write(`${line}\n`);
  }

  kill() {
    this.fail('Local voice stopped');
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    this.child.kill('SIGTERM');
    this.killTimer ??= setTimeout(() => this.child.kill('SIGKILL'), 1000);
    void this.closed.then(() => clearTimeout(this.killTimer));
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

function decodeFrame(frame: Record<string, unknown>): Float32Array {
  const { rate, data } = frame;
  if (rate !== SAMPLE_RATE || typeof data !== 'string' || !BASE64.test(data)) {
    throw new Error('Invalid local voice frame');
  }
  const raw = Buffer.from(data, 'base64');
  if (!raw.length || raw.length % 4 || raw.length > MAX_FRAME_BYTES) {
    throw new Error('Invalid PCM size');
  }
  const pcm = new Float32Array(raw.length / 4);
  for (let i = 0; i < pcm.length; i++) {
    const value = raw.readFloatLE(i * 4);
    if (!Number.isFinite(value) || Math.abs(value) > 1) throw new Error('Invalid PCM sample');
    pcm[i] = value;
  }
  return pcm;
}

function rejectAfter(ms: number, message: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  void promise.catch(() => {});
  return { promise, clear: () => clearTimeout(timer) };
}

function rejectOnAbort(signal: AbortSignal) {
  const onAbort = () => reject(new Error('Local voice cancelled'));
  let reject!: (error: Error) => void;
  const promise = new Promise<never>((_, fail) => {
    reject = fail;
  });
  void promise.catch(() => {});
  if (signal.aborted) onAbort();
  else signal.addEventListener('abort', onAbort, { once: true });
  return { promise, clear: () => signal.removeEventListener('abort', onAbort) };
}

/**
 * Keeps one Pocket process warm while voice is in use and unloads it after an idle
 * timeout. Utterances run one at a time. Stop cancels at the next frame boundary and
 * keeps the model loaded; a worker that does not acknowledge in time is killed.
 */
export class PocketVoice {
  private process?: WorkerProcess;
  private ready?: Promise<WorkerProcess>;
  private queue: Promise<unknown> = Promise.resolve();
  private idleTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly runtime: PocketRuntime,
    private readonly options: { idleMs?: number; readyMs?: number } = {},
  ) {}

  /** Start loading the model now, e.g. when a person starts holding to talk. */
  warm() {
    clearTimeout(this.idleTimer);
    void this.ensure().then(
      () => this.scheduleIdle(),
      () => {},
    );
  }

  /** Awaiting `consume` applies backpressure to inference. */
  speak(text: string, signal: AbortSignal, consume: Consume, timeoutMs = 120_000): Promise<void> {
    if (!text.trim() || text.length > 2000) {
      return Promise.reject(new Error('Voice text must be 1–2000 characters'));
    }
    const run = this.queue.then(() => this.utter(text, signal, consume, timeoutMs));
    this.queue = run.catch(() => {});
    return run;
  }

  dispose() {
    clearTimeout(this.idleTimer);
    this.process?.kill();
    this.process = undefined;
    this.ready = undefined;
  }

  private ensure(): Promise<WorkerProcess> {
    if (this.ready && this.process?.alive) return this.ready;
    const process = new WorkerProcess(this.runtime);
    this.process = process;
    const timeout = rejectAfter(
      this.options.readyMs ?? 120_000,
      'Local voice took too long to load',
    );
    this.ready = Promise.race([process.next(), timeout.promise])
      .then(frame => {
        if (frame.type !== 'ready' || frame.rate !== SAMPLE_RATE) {
          throw new Error('Invalid local voice frame');
        }
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
    const deadline = rejectAfter(timeoutMs, 'Local voice timed out');
    const abort = rejectOnAbort(signal);
    const race = <T>(work: Promise<T>) => Promise.race([work, deadline.promise, abort.promise]);
    let process: WorkerProcess | undefined;
    let clean = false;
    // Exactly one credit answers each frame; a spare credit would be read as a request.
    let awaitingCredit = false;
    try {
      process = await race(this.ensure());
      process.write(JSON.stringify({ text }));
      let frames = 0;
      let samples = 0;
      for (;;) {
        const frame = await race(process.next());
        if (frame.type === 'done') {
          if (frames === 0) throw new Error('Local voice ended unexpectedly');
          clean = true;
          return;
        }
        if (frame.type !== 'pcm') throw new Error('Invalid local voice frame');
        awaitingCredit = true;
        const pcm = decodeFrame(frame);
        samples += pcm.length;
        if (++frames > MAX_FRAMES || samples > SAMPLE_RATE * MAX_SECONDS) {
          throw new Error('Local voice output limit reached');
        }
        await race(consume(pcm, SAMPLE_RATE));
        process.write('ack');
        awaitingCredit = false;
      }
    } catch (error) {
      // Stop: tell the worker at its next frame boundary and keep the model loaded.
      if (process?.alive && signal.aborted) {
        clean = await this.drainCancelled(process, awaitingCredit);
      }
      throw error;
    } finally {
      deadline.clear();
      abort.clear();
      // Anything else leaves the worker in an unknown state: replace it next time.
      if (!clean && process === this.process) this.dispose();
      this.scheduleIdle();
    }
  }

  /** Answer every pending frame with `cancel` until the worker reports it has stopped. */
  private async drainCancelled(process: WorkerProcess, awaitingCredit: boolean) {
    const grace = rejectAfter(CANCEL_GRACE_MS, 'Local voice did not stop');
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
    this.idleTimer = setTimeout(() => this.dispose(), this.options.idleMs ?? 5 * 60_000);
    this.idleTimer.unref?.();
  }
}

/** One supervised utterance in a fresh process (the live test harness uses this). */
export async function speakPocket(
  runtime: PocketRuntime,
  text: string,
  signal: AbortSignal,
  consume: Consume,
  timeoutMs = 120_000,
): Promise<void> {
  const voice = new PocketVoice(runtime);
  try {
    await voice.speak(text, signal, consume, timeoutMs);
  } finally {
    voice.dispose();
  }
}
