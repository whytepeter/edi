import type { BrowserWindow } from 'electron';
import type {
  ArtifactRef,
  CloudProviderId,
  LocalPackId,
  Settings,
  VoicePackId,
  VoiceSelection,
  WorkspaceView,
} from '@edi/contracts';
import type { AgentService } from '../agent/agent-service';
import type { TaskService } from '../agent/task-service';
import type { Scheduler } from '../agent/scheduler';
import type { ApprovalRules } from '../agent/approval-rules';
import type { ConnectorManager } from '../connectors/manager';
import type { SkillLibrary } from '../skills/library';
import type { CharacterActions } from '../character/character-actions';
import type { CommandRoutes } from './router';
import type { PetDrag } from '../character/pet-drag';
import type { SettingsStore } from '../settings/settings-store';
import type { WindowPlacement } from '../windows/placement';
import type { VoiceController } from '../voice/voice-controller';
import { cardSize, resizePetWindow } from '../windows/factory';
import type { PermissionManager } from '../permission-manager';
import type { CharacterLibrary } from '../characters/library';

interface CommandDependencies {
  workspace: BrowserWindow;
  pet: BrowserWindow;
  settings: SettingsStore;
  agent: AgentService;
  tasks: TaskService;
  scheduler: Scheduler;
  approvalRules: ApprovalRules;
  connectors: ConnectorManager;
  skills: SkillLibrary;
  /** Documents › Edi › Skills in Finder, created if missing. */
  openSkillsFolder(): Promise<void>;
  /** Skills › Add Skill…: the folder picker, then the same check as every skill. */
  addSkill(): Promise<void>;
  /** Settings → Privacy: choose an app Edi never looks at. */
  addPrivateApp(): Promise<void>;
  /** One of the person's skills, selected in Finder. */
  revealSkill(name: string): void;
  placement: WindowPlacement;
  petDrag: PetDrag;
  character: CharacterActions;
  voice: VoiceController<unknown>;
  permissions: PermissionManager;
  /** Show a saved Library item in Finder, looked up by ID so the renderer never sends paths. */
  revealLibraryItem(id: string): void;
  /** Show an artifact in its own window beside the card. */
  openArtifact(ref: ArtifactRef): void;
  /** Copy or reveal shown content; main resolves everything from the ref. */
  artifactAction(action: 'copy' | 'reveal', ref: ArtifactRef): Promise<void>;
  /** Show the most recent export in Finder. */
  revealExport(): void;
  /** The hidden export page finished drawing (and hands back a diagram's picture). */
  exportReady(result: { svg?: string; png?: string; failed?: boolean }): void;
  /** The person drew a mark on their own screen, in that display's own pixels. */
  annotationDrawn(box: { x: number; y: number; width: number; height: number }): void;
  closeArtifact(): void;
  /** Open a validated http(s) link from a reply in the default browser. */
  openLink(url: string): Promise<void>;
  /** Save (after checking with the provider) or forget a cloud voice key. */
  setVoiceKey(provider: CloudProviderId, apiKey: string | null): Promise<void>;
  /** Settings → Voice: play a short sample of a voice. */
  previewVoice(selection: VoiceSelection): Promise<void>;
  /** Settings → Voice: move an added voice's recording to the Trash. */
  removePersonalVoice(id: string): Promise<void>;
  /** Settings → Voice: download (or resume), pause or remove an on-device voice pack. */
  voicePack(action: 'download' | 'pause' | 'remove', id: VoicePackId): Promise<void> | void;
  /** Settings → AI: download (or resume), pause or remove a model Edi runs itself. */
  localPack(action: 'download' | 'pause' | 'remove', id: LocalPackId): Promise<void> | void;
  /** Library Delete: move a note or generated item to the Trash; confirmed in the card. */
  deleteLibraryItem(id: string): Promise<void>;
  /** Library Rename, Pin and Regenerate; the person's click is the consent. */
  renameLibraryItem(id: string, title: string): Promise<void>;
  pinLibraryItem(id: string, pinned: boolean): void;
  regenerateLibraryItem(id: string): Promise<void>;
  /** A diagram that can't be drawn: Edi fixes it in place; the click is the request. */
  fixArtifact(ref: ArtifactRef, problem: string): Promise<void>;
  reportView(view: WorkspaceView): void;
  /** Built-in and installed characters. */
  characters: CharacterLibrary;
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
    tasks,
    scheduler,
    approvalRules,
    connectors,
    skills,
    openSkillsFolder,
    addSkill,
    addPrivateApp,
    revealSkill,
    placement,
    petDrag,
    character,
    voice,
    permissions,
    revealLibraryItem,
    openArtifact,
    artifactAction,
    revealExport,
    exportReady,
    annotationDrawn,
    closeArtifact,
    openLink,
    previewVoice,
    removePersonalVoice,
    voicePack,
    localPack,
    setVoiceKey,
    deleteLibraryItem,
    renameLibraryItem,
    pinLibraryItem,
    regenerateLibraryItem,
    fixArtifact,
    reportView,
    characters,
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
    'voice-pcm': {
      from: fromPet,
      handle: ({ generation, pcm, speaking }) => voice.pcm(generation, pcm, speaking),
    },
    'voice-played': {
      from: fromPet,
      handle: ({ generation, turn }) => voice.played(generation, turn),
    },
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
    'apply-skin': {
      from: fromWorkspace,
      handle: ({ skin }) => {
        if (!characters.has(skin)) throw new Error('That character is not installed.');
        const bounds = resizePetWindow(
          pet,
          settings.current.petScale,
          characters.get(skin).manifest.geometry,
        );
        return updateLayout({ skin, petPosition: { x: bounds.x, y: bounds.y } });
      },
    },
    'character-install': {
      from: fromWorkspace,
      handle: async ({ token }) => {
        await characters.install(token);
      },
    },
    'character-remove': { from: fromWorkspace, handle: ({ id }) => characters.remove(id) },
    'set-name': { from: fromWorkspace, handle: ({ name }) => settings.update({ name }) },
    'set-pinned': { from: fromWorkspace, handle: ({ pinned }) => updateLayout({ pinned }) },
    'set-speak-replies': {
      from: fromWorkspace,
      handle: ({ enabled }) => settings.update({ speakReplies: enabled }),
    },
    'remove-personal-voice': {
      from: fromWorkspace,
      handle: ({ id }) => removePersonalVoice(id),
    },
    'voice-pack': {
      from: fromWorkspace,
      handle: ({ action, id }) => voicePack(action, id),
    },
    'set-voice-delivery': {
      from: fromWorkspace,
      handle: ({ delivery }) => settings.update({ voiceDelivery: delivery }),
    },
    'set-voice-words': {
      from: fromWorkspace,
      handle: ({ words }) => settings.update({ voiceWords: words }),
    },
    'set-voice-input': {
      from: fromWorkspace,
      handle: ({ input }) => settings.update({ voiceInput: input }),
    },
    'set-share-desktop-context': {
      from: fromWorkspace,
      handle: ({ enabled }) => settings.update({ shareDesktopContext: enabled }),
    },
    'local-pack': {
      from: fromWorkspace,
      handle: ({ action, id }) => localPack(action, id),
    },
    'set-local-model': {
      from: fromWorkspace,
      // Home and the conversation card follow at once: a model on this Mac can answer.
      handle: async ({ model, use }) => {
        await settings.update({ localModel: model, localModelUse: use });
        agent.localModelChanged();
      },
    },
    'set-privacy': {
      from: fromWorkspace,
      handle: ({ paused, pauseWhenSharing }) =>
        settings.update({
          ...(paused !== undefined ? { privacyPaused: paused } : {}),
          ...(pauseWhenSharing !== undefined ? { pauseWhenSharing } : {}),
        }),
    },
    'add-private-app': { from: fromWorkspace, handle: () => addPrivateApp() },
    'remove-private-app': {
      from: fromWorkspace,
      handle: ({ bundleId }) =>
        settings.update({
          privateApps: settings.current.privateApps.filter(app => app.bundleId !== bundleId),
        }),
    },
    'set-pet-scale': {
      from: fromWorkspace,
      handle: ({ scale, commit }) => {
        const bounds = resizePetWindow(
          pet,
          scale,
          characters.get(settings.current.skin).manifest.geometry,
        );
        // While the slider moves, the card (and the slider in it) stays still even if a display
        // edge pushes Edi; it re-attaches once, when the slider settles, and the size is saved.
        if (!commit) return;
        placement.place();
        return settings.update({ petScale: scale, petPosition: { x: bounds.x, y: bounds.y } });
      },
    },
    'open-artifact': { from: ['workspace', 'bubble'], handle: ({ ref }) => openArtifact(ref) },
    'artifact-copy': { from: fromArtifact, handle: ({ ref }) => artifactAction('copy', ref) },
    'artifact-fix': {
      from: fromArtifact,
      handle: ({ ref, problem }) => fixArtifact(ref, problem),
    },
    'artifact-reveal': { from: fromArtifact, handle: ({ ref }) => artifactAction('reveal', ref) },
    'reveal-export': { from: ['artifact', 'workspace'], handle: () => revealExport() },
    'export-ready': {
      from: ['export'],
      handle: ({ type: _type, ...result }) => exportReady(result),
    },
    'annotation-drawn': {
      from: ['annotate'],
      handle: ({ type: _type, ...box }) => annotationDrawn(box),
    },
    'close-artifact': { from: fromArtifact, handle: () => closeArtifact() },
    'library-delete': { from: fromWorkspace, handle: ({ id }) => deleteLibraryItem(id) },
    'library-rename': {
      from: fromWorkspace,
      handle: ({ id, title }) => renameLibraryItem(id, title),
    },
    'library-pin': { from: fromWorkspace, handle: ({ id, pinned }) => pinLibraryItem(id, pinned) },
    'library-regenerate': { from: fromWorkspace, handle: ({ id }) => regenerateLibraryItem(id) },
    'workspace-view': { from: fromWorkspace, handle: ({ view }) => reportView(view) },
    'set-voice-model': {
      from: fromWorkspace,
      handle: ({ model }) => settings.update({ voiceModel: model }),
    },
    // Choosing a voice also selects its model; each model remembers its own voice.
    'set-voice': {
      from: fromWorkspace,
      handle: ({ selection }) =>
        settings.update({
          voiceModel: selection.model,
          voices: { ...settings.current.voices, [selection.model]: selection.voice },
        }),
    },
    'preview-voice': { from: fromWorkspace, handle: ({ selection }) => previewVoice(selection) },
    'set-voice-key': {
      from: fromWorkspace,
      handle: ({ provider, apiKey }) => setVoiceKey(provider, apiKey),
    },
    'forget-voice-key': {
      from: fromWorkspace,
      handle: ({ provider }) => setVoiceKey(provider, null),
    },
    'open-link': { from: fromWorkspace, handle: ({ url }) => openLink(url) },
    'reveal-library-item': { from: fromWorkspace, handle: ({ id }) => revealLibraryItem(id) },

    'configure-agent': {
      from: fromWorkspace,
      handle: ({ apiKey, model }) => agent.configure(apiKey, model),
    },
    'disconnect-agent': { from: fromWorkspace, handle: () => agent.disconnect() },
    'ask-agent': { from: fromWorkspace, handle: ({ prompt }) => agent.ask(prompt) },
    'stop-agent': { from: fromWorkspace, handle: () => agent.stop() },
    'new-conversation': { from: fromWorkspace, handle: () => agent.newConversation() },
    'open-conversation': { from: fromWorkspace, handle: ({ id }) => agent.openConversation(id) },
    'delete-conversation': {
      from: fromWorkspace,
      handle: ({ id }) => agent.deleteConversation(id),
    },
    'respond-approval': {
      from: ['workspace', 'bubble'],
      // The conversation's review first; otherwise it belongs to a background task.
      handle: ({ callId, decision }) =>
        agent.state.approval?.callId === callId
          ? agent.respondToApproval(callId, decision)
          : tasks.respondToApproval(callId, decision),
    },
    'start-task': {
      from: fromWorkspace,
      handle: ({ prompt, budgetUsd }) => {
        tasks.start({
          prompt,
          budgetUsd: budgetUsd ?? settings.current.taskBudgetUsd,
          conversationId: null,
        });
      },
    },
    'stop-task': { from: fromWorkspace, handle: ({ id }) => tasks.stop(id) },
    'delete-task': { from: fromWorkspace, handle: ({ id }) => tasks.remove(id) },
    'raise-task-budget': {
      from: fromWorkspace,
      handle: ({ id, addUsd }) => tasks.raiseBudget(id, addUsd),
    },
    'create-schedule': {
      from: fromWorkspace,
      handle: ({ prompt, when, notify, budgetUsd }) => {
        scheduler.create({
          prompt,
          when,
          notify,
          budgetUsd: budgetUsd ?? settings.current.taskBudgetUsd,
        });
      },
    },
    'set-schedule-enabled': {
      from: fromWorkspace,
      handle: ({ id, enabled }) => scheduler.setEnabled(id, enabled),
    },
    'delete-schedule': { from: fromWorkspace, handle: ({ id }) => scheduler.remove(id) },
    'remove-approval-rule': { from: fromWorkspace, handle: ({ id }) => approvalRules.remove(id) },
    'add-connector': {
      from: fromWorkspace,
      handle: ({ catalogId, url, name }) => {
        connectors.add({ catalogId, url, name });
      },
    },
    // Signing in waits on the browser; progress arrives through the connector list.
    'connect-connector': {
      from: fromWorkspace,
      handle: ({ id }) => {
        void connectors.connect(id, true);
      },
    },
    'set-connector-enabled': {
      from: fromWorkspace,
      handle: ({ id, enabled }) => connectors.setEnabled(id, enabled),
    },
    'set-connector-tool': {
      from: fromWorkspace,
      handle: ({ id, tool, enabled }) => connectors.setToolEnabled(id, tool, enabled),
    },
    'test-connector': { from: fromWorkspace, handle: ({ id }) => connectors.check(id) },
    'set-skill-enabled': {
      from: fromWorkspace,
      handle: ({ name, enabled }) => skills.setEnabled(name, enabled),
    },
    'remove-skill': { from: fromWorkspace, handle: ({ name }) => skills.remove(name) },
    'open-skills-folder': { from: fromWorkspace, handle: () => openSkillsFolder() },
    'add-skill': { from: fromWorkspace, handle: () => addSkill() },
    'reveal-skill': { from: fromWorkspace, handle: ({ name }) => revealSkill(name) },
    'use-recommended-tools': {
      from: fromWorkspace,
      handle: ({ id }) => connectors.useRecommendedTools(id),
    },
    'remove-connector': { from: fromWorkspace, handle: ({ id }) => connectors.remove(id) },
    'setup-composio': {
      from: fromWorkspace,
      handle: ({ apiKey }) => connectors.setComposioKey(apiKey),
    },
    'set-task-budget': {
      from: fromWorkspace,
      handle: ({ budgetUsd }) => settings.update({ taskBudgetUsd: budgetUsd }),
    },
  };
}
