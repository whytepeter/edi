/**
 * The tools a spoken turn carries with its request. Every other tool still exists and is found
 * by name in one extra step (see `CapabilityBroker.manifest`), but its schema is not sent with
 * every question.
 *
 * Chosen from recorded use: about two turns in three call no tool at all, and these cover most
 * of the rest. The full set is roughly 9,000 tokens of schemas per request; this is about a
 * third of that, and connected-app tools (often tens of thousands more) are always found by
 * search on a spoken turn. Less to read before the first word.
 */
export const QUICK_TOOLS: ReadonlySet<string> = new Set([
  // Showing and finding what Edi made.
  'workspace_show',
  'workspace_search',
  'workspace_read',
  'workspace_update',
  // Looking things up.
  'web_fetch',
  'files_search',
  'files_read',
  'files_list',
  'skills_use',
  // The everyday asks by voice.
  'calendar_events',
  'reminders_create',
  'notes_save',
  'mac_open_app',
  'mac_open_url',
  'edi_open_page',
  // "Can you hop?" should be a hop, not a search for the tool.
  'edi_window',
  // Remembering should never cost a step.
  'edi_remember',
]);
