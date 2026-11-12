import type { MessagePort } from 'node:worker_threads';
import type { ToolOutcome } from '@edi/capabilities';
import { startRun, type AgentRun } from './engine';
import type { AgentInstructions } from './instructions';
import {
  agentInputSchema,
  type AgentInput,
  type HostMessage,
  type WorkerMessage,
} from './protocol';
import type { ModelProvider } from './provider';

export interface WorkerOptions {
  /** The worker's port to its host (`parentPort`). */
  port: MessagePort;
  /**
   * What the worker was started with: a run's input, or `{ warm: true }` to load ahead of time
   * and wait for a `start` message, so the SDK is ready before the person finishes asking.
   */
  workerData: unknown;
  /** Built inside the worker from the run's input: a provider cannot cross a thread. */
  provider(input: AgentInput): ModelProvider;
  instructions?: AgentInstructions;
}

/**
 * Runs the brain in a worker thread: one run per worker, driven by `HostMessage`s and reported
 * as `WorkerMessage`s. This is one transport among others; the engine itself is `startRun`.
 */
export function serveWorker({ port, workerData, provider, instructions }: WorkerOptions) {
  let run: AgentRun | undefined;
  const pendingTools = new Map<string, (outcome: ToolOutcome) => void>();
  const send = (message: WorkerMessage) => port.postMessage(message);

  const begin = (data: unknown) => {
    if (run) return;
    // Rejected here, before any provider code, when it is malformed or too large.
    const input = agentInputSchema.parse(data);
    run = startRun(input, {
      instructions,
      provider: provider(input),
      host: {
        emit: send,
        // Every tool call goes to the host; this worker never touches the OS.
        callTool: (name, input, signal) => {
          const id = crypto.randomUUID();
          return new Promise<ToolOutcome>((resolve, reject) => {
            pendingTools.set(id, resolve);
            signal?.addEventListener(
              'abort',
              () => {
                pendingTools.delete(id);
                reject(new Error('Stopped'));
              },
              { once: true },
            );
            send({ type: 'tool-call', id, name, input });
          });
        },
      },
    });
    void run.finished.finally(() => port.close());
  };

  port.on('message', (message: HostMessage) => {
    if (message.type === 'start') begin(message.input);
    if (message.type === 'stop') run?.stop();
    if (message.type === 'wrap-up') run?.wrapUp();
    if (message.type === 'tool-result') {
      pendingTools.get(message.id)?.(message.outcome);
      pendingTools.delete(message.id);
    }
  });

  if ((workerData as { warm?: unknown } | null)?.warm !== true) begin(workerData);
}
