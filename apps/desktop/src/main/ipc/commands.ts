import type { BrowserWindow } from 'electron';
import type { ArtifactRef, Settings, WorkspaceView } from '@edi/contracts';
import type { AgentService } from '../agent/agent-service';
import type { CharacterActions } from '../character/character-actions';
import type { CommandRoutes } from './router';
import type { PetDrag } from '../character/pet-drag';
import type { SettingsStore } from '../settings/settings-store';
import type { WindowPlacement } from '../windows/placement';
import type { VoiceController } from '../voice/voice-controller';
import { cardSize, resizePetWindow } from '../windows/factory';
import type { PermissionManager } from '../permission-manager';

interface CommandDependencies {
  workspace: BrowserWindow;
  pet: BrowserWindow;
  settings: SettingsStore;
  agent: AgentService;
  placement: WindowPlacement;
  petDrag: PetDrag;
  character: CharacterActions;
  voice: VoiceController<unknown>;
  permissions: PermissionManager;
  /** Show a saved Library item in Finder, looked up by ID so the renderer never sends paths. */
  revealLibraryItem(id: string): void;
  /** Show an artifact in its own window beside the card. */
  openArtifact(ref: ArtifactRef): void;
  /** Copy, save a copy of, or reveal shown content; main resolves everything from the ref. */
  artifactAction(action: 'copy' | 'download' | 'reveal', ref: ArtifactRef): Promise<void>;
  closeArtifact(): void;
  /** Library Delete: move a note or generated item to the Trash; confirmed in the card. */
  deleteLibraryItem(id: string): Promise<void>;
  reportView(view: WorkspaceView): void;
}

const fromPet = ['pet'] as const;
const fromWorkspace = ['workspace'] as const;
const fromArtifact = ['artifact'] as const;

/** Which surface may send each command, and what it does. Exhaustive by type. */
export function createCommandRoutes(deps: CommandDependencies): CommandRoutes {
  const {
    workspace,
    pet,
    settings,
    agent,
    placement,
    petDrag,
    character,
    voice,
    permissions,
    revealLibraryItem,
    openArtifact,
    artifactAction,
    closeArtifact,
    deleteLibraryItem,
    reportView,
  } = deps;

  // Move the card immediately; the write and broadcast follow.
  const updateLayout = (patch: Partial<Settings>) => {
    const saved = settings.update(patch);
    placement.place();
    return saved;
  };

  return {
    'permissions-refresh': { from: fromWorkspace, handle: () => permissions.refresh() },
    'permission-request': {
      from: fromWorkspace,
      handle: ({ permission }) => permissions.request(permission),
    },
    'permission-open-settings': {
      from: fromWorkspace,
      handle: ({ permission }) => permissions.openSettings(permission),
    },
    'permission-dismiss': {
      from: fromWorkspace,
      handle: ({ permission }) => permissions.dismiss(permission),
    },
    'request-listening': {
      from: fromPet,
      handle: ({ mode }) => {
        // Keep receiving the held pointer even if it leaves the painted body.
        if (mode === 'push-to-talk') pet.setIgnoreMouseEvents(false);
        character.requestListening(mode);
      },
    },
    'release-listening': {
      from: fromPet,
      handle: () => {
        pet.setIgnoreMouseEvents(true, { forward: true });
        if (voice.phase !== 'idle') voice.release();
        else character.releaseListening();
      },
    },
    'character-menu': { from: fromPet, handle: ({ point }) => character.showMenu(point) },
    'character-action': { from: ['menu'], handle: ({ action }) => character.action(action) },
    'pet-drag': { from: fromPet, handle: command => petDrag.handle(command) },
    'voice-event': {
      from: fromPet,
      handle: ({ generation, event }) => voice.clientEvent(generation, event),
    },
    'voice-audio': {
      from: fromPet,
      handle: ({ generation, pcm }) => void voice.audio(generation, pcm),
    },
    'voice-played': { from: fromPet, handle: ({ generation }) => voice.played(generation) },
    'pet-hit-test': {
      from: fromPet,
      handle: ({ interactive }) => {
        if (!petDrag.active) pet.setIgnoreMouseEvents(!interactive, { forward: true });
      },
    },

    'show-workspace': {
      from: ['workspace', 'pet', 'bubble'],
      handle: ({ view }) => {
        if (view) workspace.webContents.send('edi:navigate', view);
        character.showContent();
      },
    },
    'hide-workspace': { from: fromWorkspace, handle: () => workspace.hide() },
    'set-expanded': {
      from: fromWorkspace,
      handle: ({ expanded }) =>
        placement.place({ x: 0, y: 0, ...(expanded ? cardSize.expanded : cardSize.compact) }),
    },
    'apply-skin': { from: fromWorkspace, handle: ({ skin }) => updateLayout({ skin }) },
    'set-pinned': { from: fromWorkspace, handle: ({ pinned }) => updateLayout({ pinned }) },
    'set-speak-replies': {
      from: fromWorkspace,
      handle: ({ enabled }) => settings.update({ speakReplies: enabled }),
    },
    'set-pet-scale': {
      from: fromWorkspace,
      handle: ({ scale, commit }) => {
        const bounds = resizePetWindow(pet, scale, settings.current.skin);
        // While the slider moves, the card (and the slider in it) stays still even if a display
        // edge pushes Edi; it re-attaches once, when the slider settles, and the size is saved.
        if (!commit) return;
        placement.place();
        return settings.update({ petScale: scale, petPosition: { x: bounds.x, y: bounds.y } });
      },
    },
    'open-artifact': { from: ['workspace', 'bubble'], handle: ({ ref }) => openArtifact(ref) },
    'artifact-copy': { from: fromArtifact, handle: ({ ref }) => artifactAction('copy', ref) },
    'artifact-download': {
      from: fromArtifact,
      handle: ({ ref }) => artifactAction('download', ref),
    },
    'artifact-reveal': { from: fromArtifact, handle: ({ ref }) => artifactAction('reveal', ref) },
    'close-artifact': { from: fromArtifact, handle: () => closeArtifact() },
    'library-delete': { from: fromWorkspace, handle: ({ id }) => deleteLibraryItem(id) },
    'workspace-view': { from: fromWorkspace, handle: ({ view }) => reportView(view) },
    'set-voice-model': {
      from: fromWorkspace,
      handle: ({ model }) => settings.update({ voiceModel: model }),
    },
    'reveal-library-item': { from: fromWorkspace, handle: ({ id }) => revealLibraryItem(id) },

    'configure-agent': {
      from: fromWorkspace,
      handle: ({ apiKey, model }) => agent.configure(apiKey, model),
    },
    'disconnect-agent': { from: fromWorkspace, handle: () => agent.disconnect() },
    'ask-agent': { from: fromWorkspace, handle: ({ prompt }) => agent.ask(prompt) },
    'stop-agent': { from: fromWorkspace, handle: () => agent.stop() },
    'respond-approval': {
      from: ['workspace', 'bubble'],
      handle: ({ callId, decision }) => agent.respondToApproval(callId, decision),
    },
  };
}
