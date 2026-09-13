import type { Command } from '@edi/contracts';
import { Menu, type MenuEntry } from '../../components/ui';
import './pet.css';

type Action = Extract<Command, { type: 'character-action' }>['action'];

const act = (action: Action) => void window.edi?.command({ type: 'character-action', action });

const items: MenuEntry[] = [
  { id: 'content', label: 'Open Edi', icon: 'window', onSelect: () => act('content') },
  { id: 'settings', label: 'Settings', icon: 'sliders', onSelect: () => act('settings') },
  { separator: true },
  { id: 'sleep', label: 'Sleep Edi', icon: 'moon', onSelect: () => act('sleep') },
  { id: 'quit', label: 'Quit Edi', icon: 'power', onSelect: () => act('quit') },
];

/** Right-click menu, opened by main under the pointer on Edi. */
export function CharacterMenu() {
  return (
    <div className="character-menu-surface">
      <Menu
        label="Edi options"
        material="thick"
        className="character-menu"
        items={items}
        onDismiss={() => act('dismiss')}
      />
    </div>
  );
}
