import type { Command } from '@edi/contracts';
import { Menu, type MenuEntry } from '../../components/ui';
import './pet.css';

type Action = Extract<Command, { type: 'character-action' }>['action'];

const act = (action: Action) => void window.edi?.command({ type: 'character-action', action });

const items = (name: string): MenuEntry[] => [
  { id: 'content', label: `Open ${name}`, icon: 'window', onSelect: () => act('content') },
  { id: 'settings', label: 'Settings', icon: 'sliders', onSelect: () => act('settings') },
  { separator: true },
  { id: 'sleep', label: `Sleep ${name}`, icon: 'moon', onSelect: () => act('sleep') },
  { id: 'quit', label: `Quit ${name}`, icon: 'power', onSelect: () => act('quit') },
];

/** Right-click menu, opened by main under the pointer on the character. */
export function CharacterMenu({ name }: { name: string }) {
  return (
    <div className="character-menu-surface">
      <Menu
        label={`${name} options`}
        material="thick"
        className="character-menu"
        items={items(name)}
        onDismiss={() => act('dismiss')}
      />
    </div>
  );
}
