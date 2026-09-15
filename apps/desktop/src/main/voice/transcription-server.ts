import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { PcmBuffer, type Transcriber } from './speech-io';
import {
  pcmWave,
  transcribePcm,
  transcriptionPrompt,
  type TranscriptionRuntime,
} from './transcription-process';

type Fetch = typeof fetch;

/** A free localhost port for the server; it binds 127.0.0.1 only. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() =>
        typeof address === 'object' && address
          ? resolve(address.port)
          : reject(new Error('No port')),
      );
    });
  });
}

/**
 * whisper.cpp's server with the model kept loaded, so a turn (and every pause check while the
 * person talks) costs inference only, not a model load. Audio goes to 127.0.0.1 and nowhere
 * else. If the server cannot start, each request falls back to the one-shot CLI.
 */
export class WhisperServer {
  private child?: ChildProcess;
  private ready?: Promise<string>;
  /** The start in progress; dispose clears it so a start that is still finding a port gives up. */
  private starting?: object;
  private idleTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly runtime: TranscriptionRuntime,
    private readonly server: string | null,
    private readonly options: {
      name?: () => string;
      idleMs?: number;
      readyMs?: number;
      fetch?: Fetch;
    } = {},
  ) {}

  /** Start loading the model now: called when a hold or conversation begins. */
  warm() {
    if (!this.server) return;
    void this.ensure().then(
      () => this.scheduleIdle(),
      () => {},
    );
  }

  async transcribe(pcm: Uint8Array, signal: AbortSignal): Promise<string> {
    const name = this.options.name?.() ?? 'Edi';
    if (!this.server) return transcribePcm(this.runtime, pcm, signal, undefined, name);
    let base: string;
    try {
      base = await this.ensure();
    } catch {
      return transcribePcm(this.runtime, pcm, signal, undefined, name);
    }
    clearTimeout(this.idleTimer);
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(pcmWave(pcm))], { type: 'audio/wav' }), 'turn.wav');
    form.set('response_format', 'json');
    form.set('prompt', transcriptionPrompt(name));
    try {
      const response = await (this.options.fetch ?? fetch)(`${base}/inference`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      });
      if (!response.ok) throw new Error('Transcription failed');
      const body = (await response.json()) as { text?: unknown };
      const text = typeof body.text === 'string' ? body.text.replace(/\s+/g, ' ').trim() : '';
      if (text.length > 8000) throw new Error('Transcript too long');
      return text;
    } catch (error) {
      signal.throwIfAborted();
      // A server that stopped answering is replaced on the next turn; this one still gets words.
      this.dispose();
      if (error instanceof Error && error.message === 'Transcript too long') throw error;
      return transcribePcm(this.runtime, pcm, signal, undefined, name);
    } finally {
      this.scheduleIdle();
    }
  }

  dispose() {
    clearTimeout(this.idleTimer);
    const child = this.child;
    this.child = undefined;
    this.ready = undefined;
    this.starting = undefined;
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 1000).unref?.();
    }
  }

  private ensure() {
    // One start at a time: a warm-up and the first request share it (the child only exists
    // once a port was found). Exit and dispose clear `ready`, so a dead server is replaced.
    if (this.ready) return this.ready;
    const server = this.server!;
    const start = {};
    this.starting = start;
    const ready = (async () => {
      const port = await freePort();
      if (this.starting !== start) throw new Error('Transcription server stopped');
      const child = spawn(
        server,
        [
          ...['-m', this.runtime.model, '--vad', '-vm', this.runtime.vadModel],
          ...['-l', 'en', '-t', '4', '-ng', '--host', '127.0.0.1', '--port', String(port)],
        ],
        { stdio: 'ignore', env: { PATH: '/usr/bin:/bin' } },
      );
      this.child = child;
      const exited = new Promise<never>((_, reject) => {
        child.once('exit', () => reject(new Error('Transcription server stopped')));
        child.once('error', () => reject(new Error('Transcription server could not start')));
      });
      void exited.catch(() => {
        if (this.child === child) {
          this.child = undefined;
          this.ready = undefined;
        }
      });
      const base = `http://127.0.0.1:${port}`;
      const deadline = Date.now() + (this.options.readyMs ?? 30_000);
      for (;;) {
        if (Date.now() > deadline) {
          this.dispose();
          throw new Error('Transcription server took too long to start');
        }
        const up = await Promise.race([
          (this.options.fetch ?? fetch)(base, { signal: AbortSignal.timeout(1000) }).then(
            response => response.ok,
            () => false,
          ),
          exited,
        ]);
        if (up) return base;
        await new Promise(resolve => setTimeout(resolve, 150));
      }
    })();
    this.ready = ready;
    void ready.catch(() => {
      if (this.ready === ready) this.ready = undefined;
    });
    return ready;
  }

  private scheduleIdle() {
    clearTimeout(this.idleTimer);
    if (!this.child) return;
    this.idleTimer = setTimeout(() => this.dispose(), this.options.idleMs ?? 15 * 60_000);
    this.idleTimer.unref?.();
  }
}

/** Shortest audio worth transcribing: a fifth of a second. */
const MIN_BYTES = 16_000 * 2 * 0.2;

/**
 * An utterance recognized on this Mac. Each pause re-reads the whole utterance so far (whisper
 * is not incremental); an unchanged buffer returns the last answer without running again.
 */
export function localTranscriber(
  transcribe: (pcm: Uint8Array, signal: AbortSignal) => Promise<string>,
): Transcriber {
  const buffer = new PcmBuffer();
  const abort = new AbortController();
  let last = { bytes: -1, text: '' };
  let queue: Promise<unknown> = Promise.resolve();
  return {
    push: pcm => buffer.push(pcm),
    transcript() {
      const run = queue.then(async () => {
        if (buffer.bytes === last.bytes) return last.text;
        if (buffer.bytes < MIN_BYTES) return '';
        const bytes = buffer.bytes;
        const text = await transcribe(buffer.join(), abort.signal);
        last = { bytes, text };
        return text;
      });
      queue = run.catch(() => {});
      return run;
    },
    close() {
      abort.abort();
      buffer.clear();
    },
  };
}
