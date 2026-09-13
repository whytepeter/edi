import { randomUUID } from 'node:crypto';
import { parentPort, workerData } from 'node:worker_threads';
import { jsonSchema, stepCountIs, streamText, tool, type ModelMessage, type ToolSet } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { ToolOutcome } from '@edi/capabilities';
import { workerInputSchema, type HostMessage, type WorkerMessage } from './worker-protocol';

// The worker is a process boundary. Reject malformed or unexpectedly large startup data
// before it reaches provider code, even though the current producer is trusted main.
const input = workerInputSchema.parse(workerData);
const controller = new AbortController();
const pendingTools = new Map<string, (outcome: ToolOutcome) => void>();
const send = (message: WorkerMessage) => parentPort?.postMessage(message);

// Run policy: a bounded tool loop. Main owns the wall-clock deadline and approvals.
const MAX_STEPS = 6;

const SYSTEM = [
  'You are Edi, a concise desktop companion. Answer in plain text.',
  'A message includes screenshots only when its wording refers to visible screen content. They are',
  'labelled with which screen has the cursor. Use them to answer about what is on screen.',
  'If none is attached, answer normally. Mention screen access only if the question requires it.',
  'Do not ask the user to take or send a screenshot.',
  'You can only affect the user’s Mac through the tools provided, and every change is shown',
  'to the user for approval first.',
  'If a tool result says the user declined or that it was stopped, accept it, do not retry,',
  'and say so plainly. Never claim an action happened unless its result status is "succeeded".',
].join(' ');

// Content goes in the card, not in the reply, and never gets read aloud.
const SHOWING = [
  'When the user asks to see, show, open, draft, write, list, plan, compare or organize something,',
  'or when an answer would be longer than a few sentences or needs structure, display it with',
  'workspace_show (a document, checklist or table). Use kind html only when the result needs',
  'interaction or a custom visual those cannot express (a calculator, simulation, interactive',
  'chart, color palette preview, UI mock-up): one self-contained page with inline CSS and JS, no',
  'external resources, network or storage, readable in light and dark. To display a saved note, use notes_show with',
  'its id from notes_list; use notes_read only when you need the text to answer or edit. After',
  'showing content, reply in one short sentence such as “Here’s your packing list.” Never repeat,',
  'summarize at length or read out content you displayed.',
].join(' ');

// Edi is also its own app: it can inspect and operate itself.
const SELF = [
  'You are also the Edi app. Answer questions about Edi (what is selected, what you can do, where',
  'the user is, what is missing) from the trusted setup data or edi_inspect_setup, never from',
  'assumptions. Use edi_open_page to open any page, including Settings itself, and',
  'edi_change_preferences to change the character, size, pin, voice or whether replies are spoken',
  'when asked. Use edi_window to close the card or sleep only when asked. Features listed as not',
  'yet available do not exist; say so and do not pretend.',
].join(' ');

// Pointing tags; main strips them and moves Edi's pointer.
const POINTING = [
  'When pointing at something on screen would help, end your reply with [POINT:x,y:label],',
  'where x,y are integer pixel coordinates of the center of the target within that screenshot’s',
  'image dimensions. If the target shows text, the label must be that exact visible text, e.g.',
  '[POINT:612,418:Save] or [POINT:120,40:Wi-Fi:screen2]; Edi uses it to align the pointer with',
  'the real text. Otherwise the label names the thing in a few words. Add :screenN to point at',
  'a screen other than screen 1. If pointing would not help, end with [POINT:none].',
  'Never mention the tag itself.',
  'To annotate the screen, append up to six tags on one display: [DRAW:circle:x,y,r:label],',
  '[DRAW:box:x,y,w,h:label], [DRAW:arrow:x1,y1,x2,y2:label], or [DRAW:underline:x1,y1,x2,y2:label].',
  'Circles are centered on the target, boxes follow its edges, arrows end at it. Labels follow',
  'the same exact-text rule. Use positive sizes, keep shapes inside the screenshot, and add',
  ':screenN before ] when needed.',
  'These are temporary visual annotations, never clicks or changes to another app.',
].join(' ');

// Voice turns are heard, not read: keep them short and free of formatting.
const SPOKEN = [
  'This question was spoken aloud and your reply will be read aloud.',
  'Answer in one to three short sentences of plain words: no lists, headings, code or Markdown.',
  'Anything longer or structured belongs in workspace_show; then say only one short sentence.',
].join(' ');

const EXPRESSIVE = [
  'The selected voice can perform expression tags. You may use at most one tag when it naturally',
  'improves the reply: [clear throat], [sigh], [shush], [cough], [groan], [sniff], [gasp],',
  '[chuckle], or [laugh]. Never describe or explain the tag, and do not force one into every reply.',
].join(' ');

type FailureKind = Extract<WorkerMessage, { type: 'error' }>['kind'];

/** Reduce provider errors to a safe action category; request bodies and metadata never leave here. */
function failureKind(error: unknown): FailureKind {
  const seen = new Set<unknown>();
  let value = error;
  for (let depth = 0; value && depth < 6 && !seen.has(value); depth++) {
    seen.add(value);
    if (typeof value === 'object') {
      const record = value as { statusCode?: unknown; status?: unknown; cause?: unknown };
      const status = Number(record.statusCode ?? record.status);
      if (status === 401 || status === 403) return 'auth';
      if (status === 402) return 'credits';
      if (status === 404 || status === 400 || status === 422) return 'model';
      if (status === 408 || status === 409 || status === 429 || status >= 500) return 'temporary';
      value = record.cause;
    } else break;
  }
  return 'unknown';
}

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

/** Earlier turns as text, then this question with every screen attached. */
function conversation(): ModelMessage[] {
  const history = input.history.flatMap((turn): ModelMessage[] => [
    { role: 'user', content: turn.prompt },
    { role: 'assistant', content: turn.reply },
  ]);
  const screens = input.screenshots.flatMap(shot => [
    { type: 'text' as const, text: shot.label },
    { type: 'file' as const, data: shot.jpeg, mediaType: 'image/jpeg' },
  ]);
  return [
    ...history,
    { role: 'user', content: [{ type: 'text', text: input.prompt }, ...screens] },
  ];
}

async function run() {
  try {
    let failure: FailureKind | undefined;
    const provider = createOpenRouter({ apiKey: input.apiKey });
    const result = streamText({
      model: provider(input.model),
      system: [
        SYSTEM,
        SHOWING,
        SELF,
        input.selfContext ? `Current Edi setup (trusted runtime data): ${input.selfContext}` : '',
        input.screenshots.length ? POINTING : '',
        input.spoken ? SPOKEN : '',
        input.spoken && input.expressiveVoice ? EXPRESSIVE : '',
      ]
        .filter(Boolean)
        .join(' '),
      messages: conversation(),
      tools,
      stopWhen: stepCountIs(MAX_STEPS),
      // Shown content arrives as tool arguments, so a report or an interactive page needs room;
      // providers bill generated tokens, not this ceiling.
      maxOutputTokens: 16_000,
      // OpenRouter already routes across providers; the SDK retries transient transport/provider
      // failures twice before Edi asks the person to intervene.
      maxRetries: 2,
      providerOptions: { openrouter: { provider: { allow_fallbacks: true } } },
      onError: ({ error }) => {
        failure = failureKind(error);
      },
      abortSignal: controller.signal,
    });
    for await (const text of result.textStream) send({ type: 'text', text });
    send(failure ? { type: 'error', kind: failure } : { type: 'done' });
  } catch (error) {
    // Provider exceptions can contain request metadata. Never forward or log them.
    send({ type: 'error', kind: failureKind(error) });
  } finally {
    parentPort?.close();
  }
}
void run();
