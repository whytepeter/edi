import { randomUUID } from 'node:crypto';
import { memoryProblem, refuseToRemember, type Memory, type MemoryKind } from '@edi/contracts';

/** The part of the memory store Settings writes to. */
interface MemoryStore {
  list(): Memory[];
  add(memory: Memory): void;
  update(id: string, change: { text: string; at: number }): void;
  remove(id: string): void;
  clear(): void;
}

/**
 * What Settings → Memory can do to what Edi remembers. A line typed there passes the same checks
 * as one Edi asks to remember: no passwords, keys or card numbers, and nothing it already has.
 * `changed` runs after every change, so open windows show it.
 */
export function memoryRoutes(
  memories: MemoryStore,
  changed: () => void,
  now: () => number = Date.now,
) {
  return {
    add(kind: MemoryKind, text: string) {
      const problem = memoryProblem(text, memories.list());
      if (problem) throw new Error(problem);
      const at = now();
      memories.add({ id: randomUUID(), kind, text: text.trim(), createdAt: at, updatedAt: at });
      changed();
    },
    edit(id: string, text: string) {
      const refused = refuseToRemember(text);
      if (refused) throw new Error(refused);
      memories.update(id, { text, at: now() });
      changed();
    },
    remove(id: string) {
      memories.remove(id);
      changed();
    },
    clear() {
      memories.clear();
      changed();
    },
  };
}
