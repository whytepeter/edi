import { randomUUID } from 'node:crypto';
import { parentPort, workerData } from 'node:worker_threads';
import { jsonSchema, stepCountIs, streamText, tool, type ToolSet } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { ToolOutcome } from '@edi/capabilities';
import type { HostMessage, WorkerInput, WorkerMessage } from './worker-protocol';

const input = workerData as WorkerInput;
const controller = new AbortController();
const pendingTools = new Map<string, (outcome: ToolOutcome) => void>();
const send = (message: WorkerMessage) => parentPort?.postMessage(message);

// Run policy: a bounded tool loop. Main owns the wall-clock deadline and approvals.
const MAX_STEPS = 6;

const SYSTEM = [
  'You are Edi, a concise desktop companion. Answer in plain text.',
  'You cannot see the screen.',
  'You can only affect the user’s Mac through the tools provided, and every change is shown',
  'to the user for approval first.',
  'If a tool result says the user declined or that it was stopped, accept it, do not retry,',
  'and say so plainly. Never claim an action happened unless its result status is "succeeded".',
].join(' ');

parentPort?.on('message', (message: HostMessage) => {
  if (message.type === 'stop') controller.abort();
  if (message.type === 'tool-result') {
    pendingTools.get(message.id)?.(message.outcome);
    pendingTools.delete(message.id);
  }
});

/** Every tool call goes to the capability broker in main; this worker never touches the OS. */
function callHost(name: string, args: unknown, signal?: AbortSignal): Promise<ToolOutcome> {
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    pendingTools.set(id, resolve);
    signal?.addEventListener(
      'abort',
      () => {
        pendingTools.delete(id);
        reject(new Error('Stopped'));
      },
      { once: true },
    );
    send({ type: 'tool-call', id, name, input: args });
  });
}

const tools: ToolSet = Object.fromEntries(
  input.tools.map(entry => [
    entry.name,
    tool({
      description: entry.description,
      inputSchema: jsonSchema(entry.inputSchema),
      execute: (args, { abortSignal }) => callHost(entry.name, args, abortSignal),
    }),
  ]),
);

async function run() {
  try {
    let failed = false;
    const provider = createOpenRouter({ apiKey: input.apiKey });
    const result = streamText({
      model: provider(input.model),
      system: SYSTEM,
      prompt: input.prompt,
      tools,
      stopWhen: stepCountIs(MAX_STEPS),
      maxOutputTokens: 2048,
      maxRetries: 0,
      onError: () => {
        failed = true;
      },
      abortSignal: controller.signal,
    });
    for await (const text of result.textStream) send({ type: 'text', text });
    send({ type: failed ? 'error' : 'done' });
  } catch {
    // Provider exceptions can contain request metadata. Never forward or log them.
    send({ type: 'error' });
  } finally {
    parentPort?.close();
  }
}
void run();
