import { randomUUID } from 'node:crypto';
import type { ToolCallRecorder } from '@edi/capabilities';
import type { Repositories } from '@edi/storage';
import type { WorkerMessage } from '@edi/agent';

// The boundary itself lives with the brain; main adds how it records what crosses it.
export {
  workerInputSchema,
  workerMessageSchema,
  type HostMessage,
  type WorkerInput,
  type WorkerMessage,
} from '@edi/agent';

/** Records a search OpenRouter ran as a finished, read-only step of `runId`. */
export function recordWebSearch(
  recorder: ToolCallRecorder,
  runId: string,
  search: Extract<WorkerMessage, { type: 'web-search' }>,
) {
  const id = randomUUID();
  const hosts = [...new Set(search.pages.map(page => new URL(page.url).hostname))].slice(0, 3);
  recorder.created({
    id,
    runId,
    capability: 'web.search',
    title: 'Search the web',
    effect: 'read',
    input: { query: search.query },
    status: 'running',
  });
  recorder.finished(id, {
    status: 'succeeded',
    summary:
      (search.query ? `Searched “${search.query}”. ` : '') +
      (search.pages.length
        ? `Found ${search.pages.length === 1 ? '1 page' : `${search.pages.length} pages`} (${hosts.join(', ')}).`
        : 'Found nothing to cite.'),
    output: search,
  });
}

/** Keeps a failed call's safe summary for diagnosis; best effort, never blocks the run. */
export function recordFailure(
  repositories: Pick<Repositories, 'failures'>,
  runId: string,
  model: string,
  failure: Extract<WorkerMessage, { type: 'error' }>,
) {
  if (!failure.detail) return;
  try {
    repositories.failures.add({ runId, model, kind: failure.kind, ...failure.detail }, Date.now());
  } catch {
    // Diagnostics never get in the way of telling the person what happened.
  }
}
