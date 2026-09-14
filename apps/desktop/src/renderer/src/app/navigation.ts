import type { WorkspaceSection, WorkspaceView } from '@edi/contracts';
import type { IconName } from '../components/ui';

export interface Destination {
  id: WorkspaceSection;
  label: string;
  icon: IconName;
}

/** Top-level sections, in menu order. Settings is kept apart at the end. */
export const primaryDestinations: readonly Destination[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'conversations', label: 'Conversations', icon: 'chat' },
  { id: 'tasks', label: 'Tasks', icon: 'tasks' },
  { id: 'library', label: 'Library', icon: 'library' },
  { id: 'skills', label: 'Skills', icon: 'sparkles' },
  { id: 'connectors', label: 'Connectors', icon: 'plug' },
  { id: 'appearance', label: 'Appearance', icon: 'face' },
];
export const settingsDestination: Destination = {
  id: 'settings',
  label: 'Settings',
  icon: 'sliders',
};

const pageTitles: Record<Exclude<WorkspaceView, WorkspaceSection>, string> = {
  'settings.ai': 'AI',
  'settings.voice': 'Voice',
  'settings.usage': 'Usage',
  'settings.keyboard': 'Keyboard',
  'settings.privacy': 'Privacy & Permissions',
  'settings.activity': 'Activity',
  'settings.about': 'About Edi',
};

/** The section a view belongs to; settings pages belong to Settings. */
export function sectionOf(view: WorkspaceView): WorkspaceSection {
  return view.startsWith('settings') ? 'settings' : (view as WorkspaceSection);
}

/** Where Back goes from a nested page, or null at the top of a section. */
export function parentOf(view: WorkspaceView): WorkspaceView | null {
  if (view === 'settings.activity') return 'settings.privacy';
  return view.startsWith('settings.') ? 'settings' : null;
}

export function titleOf(view: WorkspaceView) {
  if (view in pageTitles) return pageTitles[view as keyof typeof pageTitles];
  const section = [...primaryDestinations, settingsDestination].find(entry => entry.id === view);
  return section?.label ?? 'Edi';
}
