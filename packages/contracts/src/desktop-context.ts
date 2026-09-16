import { z } from 'zod';

/**
 * What the person has open when they ask: the app and window in front (not Edi's own), the page
 * address in a browser, the document, and any selected text. Gathered locally at the moment of
 * the question, sent only with that question, never stored. Titles, pages and selections are
 * data from other apps, not instructions.
 */
export const desktopContextSchema = z
  .object({
    app: z.string().min(1).max(120),
    bundleId: z.string().max(200).nullable(),
    windowTitle: z.string().max(300).nullable(),
    /** http(s) address of the browser's current tab; never from private or incognito windows. */
    url: z.string().max(2048).nullable(),
    /** The focused window's file, shown with ~ for the home folder. */
    document: z.string().max(1024).nullable(),
    selectedText: z.string().max(4000).nullable(),
  })
  .strict();
export type DesktopContext = z.infer<typeof desktopContextSchema>;

/** Apps whose window titles and selections are never read. */
export const privateContextApps: ReadonlySet<string> = new Set([
  'com.1password.1password',
  'com.agilebits.onepassword7',
  'com.bitwarden.desktop',
  'com.lastpass.LastPass',
  'com.dashlane.dashlanephonefinal',
  'com.apple.keychainaccess',
  'com.apple.Passwords',
  'org.keepassxc.keepassxc',
]);

/** Plain text for the model, marked as data. Empty when nothing useful is known. */
export function describeDesktopContext(context: DesktopContext | null): string {
  if (!context) return '';
  const lines = [`App: ${context.app}`];
  if (context.windowTitle) lines.push(`Window: ${context.windowTitle}`);
  if (context.url) lines.push(`Page: ${context.url}`);
  if (context.document) lines.push(`Document: ${context.document}`);
  if (context.selectedText) lines.push(`Selected text:\n"""\n${context.selectedText}\n"""`);
  return lines.join('\n');
}

const clip = (value: unknown, max: number) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

/** Only http(s), no credentials or fragment; query strings that look like secrets are dropped. */
export function safePageUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password) return null;
    url.hash = '';
    if (/token|secret|password|passwd|session|auth|code|key|sig/i.test(url.search)) url.search = '';
    const text = url.toString();
    return text.length <= 2048 ? text : null;
  } catch {
    return null;
  }
}

/**
 * Turn the native report (untrusted JSON from another app's window) into a bounded context.
 * Private apps keep only their name; documents are file paths shown with ~.
 */
export function normalizeDesktopContext(
  raw: unknown,
  extra: { home: string },
): DesktopContext | null {
  if (!raw || typeof raw !== 'object') return null;
  const report = raw as Record<string, unknown>;
  const app = clip(report.app, 120);
  if (!app) return null;
  const bundleId = clip(report.bundleId, 200);
  const windowTitle = clip(report.windowTitle, 300);
  const privateWindow =
    windowTitle !== null && /\b(incognito|private browsing|inprivate)\b/i.test(windowTitle);
  if ((bundleId && privateContextApps.has(bundleId)) || privateWindow)
    return { app, bundleId, windowTitle: null, url: null, document: null, selectedText: null };
  let document: string | null = null;
  let url: string | null = null;
  const rawDocument = clip(report.document, 4096);
  if (rawDocument?.startsWith('file://')) {
    try {
      const path = decodeURIComponent(new URL(rawDocument).pathname);
      document = (
        path.startsWith(`${extra.home}/`) ? `~${path.slice(extra.home.length)}` : path
      ).slice(0, 1024);
    } catch {
      document = null;
    }
  } else if (rawDocument) url = safePageUrl(rawDocument); // a browser's current tab
  const selected = typeof report.selectedText === 'string' ? report.selectedText : '';
  return {
    app,
    bundleId,
    windowTitle,
    url,
    document,
    selectedText: selected.trim() ? selected.slice(0, 4000) : null,
  };
}
