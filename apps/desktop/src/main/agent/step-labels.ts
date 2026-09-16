import type { AgentState } from '@edi/contracts';

/** Short progress for the bubble and for spoken updates: only real work (a step or a web search). */
export const stepLabels: Record<string, string> = {
  'workspace.show': 'Putting it together',
  'workspace.search': 'Looking through your workspace',
  'workspace.read': 'Reading your workspace',
  'workspace.update': 'Updating it',
  'workspace.delete': 'Tidying up',
  'workspace.export': 'Exporting it',
  'notes.save': 'Saving your note',
  'notes.list': 'Checking your notes',
  'notes.read': 'Reading your note',
  'notes.edit': 'Editing your note',
  'notes.delete': 'Removing the note',
  'notes.show': 'Opening your note',
  'web.fetch': 'Reading a page',
  'web.search': 'Searching the web',
  'tasks.start': 'Starting a background task',
  'tasks.list': 'Checking your tasks',
  'schedules.create': 'Scheduling it',
  'schedules.list': 'Checking your schedules',
  'schedules.delete': 'Removing the schedule',
  'files.search': 'Searching your files',
  'files.list': 'Looking in a folder',
  'files.read': 'Reading a file',
  'files.move': 'Moving files',
  'files.create_folder': 'Making folders',
  'files.trash': 'Moving to the Trash',
  'mac.open_app': 'Opening the app',
  'mac.open_url': 'Opening the link',
  'mac.open_file': 'Opening the file',
  'mac.reveal': 'Showing it in Finder',
  'reminders.list': 'Checking your reminders',
  'reminders.create': 'Adding reminders',
  'calendar.events': 'Checking your calendar',
  'calendar.create': 'Adding the event',
  'edi.open_page': 'Opening that',
  'edi.change_preferences': 'Adjusting myself',
  'edi.inspect_setup': 'Checking my settings',
};

/** The step currently doing work, or a web search the model runs itself. */
export function activeWork(state: Pick<AgentState, 'steps' | 'activity'>) {
  const step = [...state.steps]
    .reverse()
    .find(item => item.status === 'running' || item.status === 'awaiting-approval');
  if (step)
    return { id: step.callId, capability: step.capability, title: step.title, status: step.status };
  if (state.activity === 'searching-web')
    return {
      id: 'web-search',
      capability: 'web.search',
      title: 'Searching the web',
      status: 'running' as const,
    };
  return null;
}

export function progressLabel(state: Pick<AgentState, 'steps' | 'activity'>) {
  const work = activeWork(state);
  if (!work) return undefined;
  return stepLabels[work.capability] ?? work.title.slice(0, 40);
}
