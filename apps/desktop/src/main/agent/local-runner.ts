import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import type { LocalPackId } from '@edi/contracts';
import type { ModelPacks } from './model-packs';

/** A free loopback port for the runner; it binds 127.0.0.1 only. */
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
 * The runner that ships with Edi: in Resources for a packaged app, in `native/llama/build`
 * while developing. Null when this build has none, so Settings can say so instead of failing.
 */
export function resolveLlamaServer(paths: {
  appPath: string;
  packaged: boolean;
  resourcesPath: string;
}) {
  const server = paths.packaged
    ? join(paths.resourcesPath, 'llama/llama-server')
    : resolve(paths.appPath, '../../native/llama/build/llama-server');
  return existsSync(server) ? server : null;
}

/** Loading several gigabytes from disk the first time is slow; after that it is cached. */
const READY_MS = 180_000;
/** A model holds a lot of memory: give it back when nobody has asked for a while. */
const IDLE_MS = 20 * 60_000;

/**
 * The model runner Edi ships (llama.cpp's server), serving one downloaded model on a loopback
 * port with an OpenAI-style API: tool calling through the model's own chat template, images
 * through its projector. One model at a time, on the GPU, with the web UI off; nothing is
 * reachable from outside this Mac.
 */
export class LocalRunner {
  private child?: ChildProcess;
  private running?: { pack: LocalPackId; ready: Promise<string> };
  /** The start in progress, so one that is still finding a port gives up when stopped. */
  private starting?: object;
  private idleTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly options: {
      /** The llama-server that ships with Edi; null when this build has none. */
      server: string | null;
      packs: ModelPacks;
      readyMs?: number;
      idleMs?: number;
      fetch?: typeof fetch;
      /** Replaces starting a real program in tests. */
      spawn?: typeof spawn;
    },
  ) {}

  /** Whether Edi can run a downloaded model at all in this build. */
  get available() {
    return Boolean(this.options.server);
  }

  /**
   * Serve one downloaded model, starting the runner or reusing the one already up, and resolve
   * with its base URL. Null when the runner or the model's files are missing, or it won't start.
   */
  async serve(pack: LocalPackId): Promise<string | null> {
    const server = this.options.server;
    const installed = this.options.packs.installedPacks().find(entry => entry.id === pack);
    if (!server || !installed) return null;
    // Only one model is loaded at a time: another choice replaces it.
    if (this.running && this.running.pack !== pack) this.stop();
    clearTimeout(this.idleTimer);
    this.running ??= {
      pack,
      ready: this.start(server, {
        model: installed.modelPath,
        mmproj: installed.mmprojPath,
        contextLength: installed.contextLength,
      }),
    };
    try {
      const base = await this.running.ready;
      this.scheduleIdle();
      return base;
    } catch {
      this.stop();
      return null;
    }
  }

  /** Stop the runner and give its memory back. */
  stop() {
    clearTimeout(this.idleTimer);
    const child = this.child;
    this.child = undefined;
    this.running = undefined;
    this.starting = undefined;
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 1000).unref?.();
    }
  }

  private start(
    server: string,
    model: { model: string; mmproj: string; contextLength: number },
  ): Promise<string> {
    const start = {};
    this.starting = start;
    const ready = (async () => {
      const port = await freePort();
      if (this.starting !== start) throw new Error('The model runner stopped.');
      const child = (this.options.spawn ?? spawn)(
        server,
        [
          ...['-m', model.model, '--mmproj', model.mmproj],
          ...['-c', String(model.contextLength), '-ngl', '999', '-np', '1'],
          ...['--host', '127.0.0.1', '--port', String(port)],
          // Nothing to browse to, and no warm-up run before the first question.
          ...['--no-webui', '--no-warmup'],
        ],
        { stdio: 'ignore', env: { PATH: '/usr/bin:/bin' } },
      );
      this.child = child;
      const exited = new Promise<never>((_, reject) => {
        child.once('exit', () => reject(new Error('The model runner stopped.')));
        child.once('error', () => reject(new Error('The model runner could not start.')));
      });
      void exited.catch(() => {
        if (this.child === child) {
          this.child = undefined;
          this.running = undefined;
        }
      });
      const base = `http://127.0.0.1:${port}`;
      const deadline = Date.now() + (this.options.readyMs ?? READY_MS);
      for (;;) {
        if (Date.now() > deadline) {
          this.stop();
          throw new Error('The model took too long to load.');
        }
        // 200 once the model is loaded; 503 while it still is.
        const up = await Promise.race([
          (this.options.fetch ?? fetch)(`${base}/health`, {
            signal: AbortSignal.timeout(1000),
          }).then(
            response => response.ok,
            () => false,
          ),
          exited,
        ]);
        if (up) return base;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    })();
    void ready.catch(() => {
      if (this.running?.ready === ready) this.running = undefined;
    });
    return ready;
  }

  private scheduleIdle() {
    clearTimeout(this.idleTimer);
    if (!this.child) return;
    this.idleTimer = setTimeout(() => this.stop(), this.options.idleMs ?? IDLE_MS);
    this.idleTimer.unref?.();
  }
}
