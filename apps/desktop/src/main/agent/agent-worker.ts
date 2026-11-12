import { parentPort, workerData } from 'node:worker_threads';
import { openRouterProvider } from '@edi/agent';
import { serveWorker } from '@edi/agent/worker';
import { ediInstructions } from './edi-instructions';

/**
 * The brain's worker thread in the desktop app: the engine from `@edi/agent`, answering as Edi
 * and calling models through OpenRouter on the person's key. Main owns the wall-clock deadline,
 * approvals and spending; this thread never touches the OS.
 */
if (parentPort)
  serveWorker({
    port: parentPort,
    workerData,
    provider: input => openRouterProvider({ apiKey: input.apiKey }),
    instructions: ediInstructions,
  });
