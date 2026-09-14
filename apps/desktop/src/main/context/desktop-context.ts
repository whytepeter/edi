import { homedir } from 'node:os';
import { normalizeDesktopContext, type DesktopContext } from '@edi/contracts';
import { frontWindowContextJson } from '../permissions';

/**
 * Gathered when a question is asked, off the main thread. Everything comes from the window
 * list and Accessibility (browsers report the current tab's address as the window's document),
 * so no per-app Automation prompts are needed.
 */
export async function captureDesktopContext(): Promise<DesktopContext | null> {
  if (process.platform !== 'darwin') return null;
  const json = await frontWindowContextJson(process.pid);
  if (!json) return null;
  try {
    return normalizeDesktopContext(JSON.parse(json), { home: homedir() });
  } catch {
    return null;
  }
}
