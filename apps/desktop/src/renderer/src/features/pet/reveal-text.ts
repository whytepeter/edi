/** Grow `shown` toward `incoming` so a late flush still reads as a stream. */
export function nextRevealedText(shown: string, incoming: string, step = 3) {
  if (!incoming) return '';
  if (!incoming.startsWith(shown)) return incoming;
  return incoming.slice(0, Math.min(incoming.length, shown.length + step));
}
