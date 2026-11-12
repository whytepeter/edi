import { toArtifactContent } from '@edi/capabilities';
import { artifactPreview, type ArtifactSummary } from '@edi/contracts';

/** The tools whose results appear in a conversation as cards. */
export const DISPLAY_CAPABILITIES = ['workspace.show', 'notes.show'] as const;

/** A stored call to one of the display tools. */
interface ShownCall {
  id: string;
  runId: string;
  capability: string;
  input: unknown;
  output: unknown;
}

/** Where the cards are read from: the display calls of some runs, and content as it is now. */
export interface ThreadArtifactSources {
  shown(filter: { runIds: string[] }): ShownCall[];
  /** Shown content by id, as it is now; undefined once the person deleted it. */
  artifact(id: string): { id: string; content: unknown } | null | undefined;
}

type ShowInput = Parameters<typeof toArtifactContent>[0];

/** A stored display call as a conversation card; malformed history is skipped. */
export function summarizeShown(call: Omit<ShownCall, 'runId'>): ArtifactSummary | null {
  try {
    if (call.capability === 'workspace.show') {
      const content = toArtifactContent(call.input as ShowInput);
      return {
        id: call.id,
        kind: content.kind,
        title: content.title,
        preview: artifactPreview(content),
      };
    }
    const noteId = String((call.input as { id?: unknown }).id ?? '');
    const title = String((call.output as { title?: unknown } | null)?.title ?? 'Note').slice(
      0,
      120,
    );
    return { id: call.id, kind: 'note', title, preview: '', noteId };
  } catch {
    return null;
  }
}

/** Most cards one reply shows in the conversation: the latest ones. */
const CARDS_PER_RUN = 6;

/**
 * The cards under each reply of a conversation: what that run showed. Deleted content leaves the
 * conversation too, and content changed since shows its current title, not the one it had.
 */
export function threadArtifacts(from: ThreadArtifactSources, runIds: string[]) {
  const byRun = new Map<string, ArtifactSummary[]>();
  for (const call of from.shown({ runIds })) {
    const record = call.capability === 'workspace.show' ? from.artifact(call.id) : null;
    if (call.capability === 'workspace.show' && !record) continue;
    const summary = record
      ? summarizeShown({ ...call, input: record.content })
      : summarizeShown(call);
    if (summary)
      byRun.set(call.runId, [...(byRun.get(call.runId) ?? []), summary].slice(-CARDS_PER_RUN));
  }
  return byRun;
}
