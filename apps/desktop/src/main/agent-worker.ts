import { parentPort, workerData } from 'node:worker_threads';
import { streamText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

const controller = new AbortController();
parentPort?.on('message', () => controller.abort());
async function run() {
  try {
    let failed = false;
    const provider = createOpenRouter({ apiKey: workerData.apiKey });
    const result = streamText({
      model: provider(workerData.model),
      system: 'You are Edi, a concise desktop companion. Answer in plain text. You cannot see the screen, use tools, or perform actions. Do not claim to have done so.',
      prompt: workerData.prompt,
      maxOutputTokens: 2048,
      maxRetries: 0,
      onError: () => { failed = true; },
      abortSignal: controller.signal,
    });
    for await (const text of result.textStream) parentPort?.postMessage({ type: 'text', text });
    parentPort?.postMessage({ type: failed ? 'error' : 'done' });
  } catch {
    // Provider exceptions can contain request metadata. Never forward or log them.
    parentPort?.postMessage({ type: 'error' });
  } finally { parentPort?.close(); }
}
void run();
