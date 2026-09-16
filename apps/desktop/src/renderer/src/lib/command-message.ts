/** Main's own words from a failed command, without Electron's "Error invoking…" wrapper. */
export function commandMessage(error: unknown, fallback: string) {
  const text = error instanceof Error ? error.message : '';
  const match = /Error: ([^]*)$/.exec(text);
  return (match?.[1] ?? '').trim().slice(0, 240) || fallback;
}
