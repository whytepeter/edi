import { randomUUID } from 'node:crypto';
import { parentPort, workerData } from 'node:worker_threads';
import { jsonSchema, stepCountIs, streamText, tool, type ModelMessage, type ToolSet } from 'ai';
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
  'Each message may include screenshots of the user’s screens, taken the moment they asked and',
  'labelled with which screen has the cursor. Use them to answer about what is on screen.',
  'If no screenshot is attached, you cannot see the screen; say so rather than guessing.',
  'You can only affect the user’s Mac through the tools provided, and every change is shown',
  'to the user for approval first.',
  'If a tool result says the user declined or that it was stopped, accept it, do not retry,',
  'and say so plainly. Never claim an action happened unless its result status is "succeeded".',
].join(' ');

// heyclicky's pointing convention; main strips the tag and moves Edi's pointer.
const POINTING = [
  'When pointing at something on screen would help, end your reply with [POINT:x,y:label],',
  'where x,y are integer pixel coordinates within that screenshot’s image dimensions and label',
  'names the thing in a few words. Add :screenN, e.g. [POINT:120,40:Wi-Fi:screen2], to point',
  'at a screen other than screen 1. If pointing would not help, end with [POINT:none].',
  'Never mention the tag itself.',
].join(' ');

// Voice turns are heard, not read: keep them short and free of formatting.
const SPOKEN = [
  'This question was spoken aloud and your reply will be read aloud.',
  'Answer in one to three short sentences of plain words: no lists, headings, code or Markdown.',
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

/** Earlier turns as text, then this question with every screen attached (heyclicky's model). */
function conversation(): ModelMessage[] {
  const history = input.history.flatMap((turn): ModelMessage[] => [
    { role: 'user', content: turn.prompt },
    { role: 'assistant', content: turn.reply },
  ]);
  const screens = input.screenshots.flatMap(shot => [
    { type: 'text' as const, text: shot.label },
    { type: 'image' as const, image: shot.jpeg, mediaType: 'image/jpeg' },
  ]);
  return [
    ...history,
    { role: 'user', content: [{ type: 'text', text: input.prompt }, ...screens] },
  ];
}

async function run() {
  try {
    let failed = false;
    const provider = createOpenRouter({ apiKey: input.apiKey });
    const result = streamText({
      model: provider(input.model),
      system: [SYSTEM, input.screenshots.length ? POINTING : '', input.spoken ? SPOKEN : '']
        .filter(Boolean)
        .join(' '),
      messages: conversation(),
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
