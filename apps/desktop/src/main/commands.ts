import type { BrowserWindow } from 'electron';
import type { Settings } from '@edi/contracts';
import type { AgentService } from './agent-service';
import type { CharacterActions } from './character-actions';
import type { CommandRoutes } from './ipc';
import type { PetDrag } from './pet-drag';
import type { SettingsStore } from './settings-store';
import type { WindowPlacement } from './window-placement';
import { cardSize } from './windows';

interface CommandDependencies {
  workspace: BrowserWindow;
  pet: BrowserWindow;
  settings: SettingsStore;
  agent: AgentService;
  placement: WindowPlacement;
  petDrag: PetDrag;
  character: CharacterActions;
}

const fromPet = ['pet'] as const;
const fromWorkspace = ['workspace'] as const;

/** Which surface may send each command, and what it does. Exhaustive by type. */
export function createCommandRoutes(deps: CommandDependencies): CommandRoutes {
  const { workspace, pet, settings, agent, placement, petDrag, character } = deps;

  // Move the card immediately; the write and broadcast follow.
  const updateLayout = (patch: Partial<Settings>) => {
    const saved = settings.update(patch);
    placement.place();
    return saved;
  };

  return {
    'request-listening': {
      from: fromPet,
      handle: ({ mode }) => {
        character.requestListening(mode);
        // Keep receiving the held pointer even if it leaves the painted body.
        if (mode === 'push-to-talk') pet.setIgnoreMouseEvents(false);
      },
    },
    'release-listening': {
      from: fromPet,
      handle: () => {
        character.releaseListening();
        pet.setIgnoreMouseEvents(true, { forward: true });
      },
    },
    'character-menu': { from: fromPet, handle: () => character.showMenu() },
    'character-action': { from: ['menu'], handle: ({ action }) => character.action(action) },
    'pet-drag': { from: fromPet, handle: command => petDrag.handle(command) },
    'pet-hit-test': {
      from: fromPet,
      handle: ({ interactive }) => {
        if (!petDrag.active) pet.setIgnoreMouseEvents(!interactive, { forward: true });
      },
    },

    'show-workspace': { from: ['workspace', 'pet'], handle: () => placement.show() },
    'hide-workspace': { from: fromWorkspace, handle: () => workspace.hide() },
    'set-expanded': {
      from: fromWorkspace,
      handle: ({ expanded }) =>
        placement.place({ x: 0, y: 0, ...(expanded ? cardSize.expanded : cardSize.compact) }),
    },
    'apply-skin': { from: fromWorkspace, handle: ({ skin }) => updateLayout({ skin }) },
    'set-pinned': { from: fromWorkspace, handle: ({ pinned }) => updateLayout({ pinned }) },

    'configure-agent': {
      from: fromWorkspace,
      handle: ({ apiKey, model }) => agent.configure(apiKey, model),
    },
    'disconnect-agent': { from: fromWorkspace, handle: () => agent.disconnect() },
    'ask-agent': { from: fromWorkspace, handle: ({ prompt }) => agent.ask(prompt) },
    'stop-agent': { from: fromWorkspace, handle: () => agent.stop() },
  };
}
