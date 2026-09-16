/**
 * Finding connected-app tools that aren't shown to the model up front. Plain word matching over
 * each tool's name, app and description: cheap, local, and good enough for "send an email" →
 * `GMAIL_SEND_EMAIL`.
 */

export interface SearchableTool {
  name: string;
  description: string;
  app?: string;
}

/** Found tools offered per search, and at most this many found tools kept active at once. */
export const FOUND_PER_SEARCH = 8;
export const MAX_ACTIVE_FOUND = 32;

const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(word => word.length > 1)
    // "emails" finds "email", "issues" finds "issue".
    .map(word => (word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word));

export function findAppTools<T extends SearchableTool>(
  tools: readonly T[],
  query: string,
  limit = FOUND_PER_SEARCH,
): T[] {
  const wanted = [...new Set(words(query))];
  if (!wanted.length) return [];
  return tools
    .map(tool => {
      const name = new Set(words(tool.name));
      const app = new Set(words(tool.app ?? ''));
      const about = new Set(words(tool.description));
      let score = 0;
      for (const word of wanted) {
        if (name.has(word)) score += 3;
        else if (about.has(word)) score += 1;
        if (app.has(word)) score += 2;
      }
      return { tool, score };
    })
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(entry => entry.tool);
}

/** Adds newly found tools, dropping the oldest when more than `MAX_ACTIVE_FOUND` are active. */
export function activate(active: Set<string>, found: readonly string[]) {
  for (const name of found) {
    active.delete(name);
    active.add(name);
  }
  for (const name of active) {
    if (active.size <= MAX_ACTIVE_FOUND) break;
    active.delete(name);
  }
}
