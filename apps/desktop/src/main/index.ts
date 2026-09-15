import { z } from 'zod';
import {
  app,
  BrowserWindow,
  clipboard,
  Notification,
  powerMonitor,
  dialog,
  globalShortcut,
  Menu,
  screen,
  safeStorage,
  shell,
  systemPreferences,
} from 'electron';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';

if (process.env.EDI_CWD) process.chdir(process.env.EDI_CWD);
// Tests keep Edi's workspace (Documents › Edi) in a temporary folder, never the person's own.
if (process.env.EDI_DOCUMENTS) app.setPath('documents', process.env.EDI_DOCUMENTS);

function recordMicrophoneStatus(phase: string) {
  const out = process.env.EDI_MIC_OUT;
  if (!out) return;
  try {
    writeFileSync(out, `${phase}=${systemPreferences.getMediaAccessStatus('microphone')}\n`, {
      flag: 'a',
    });
  } catch {
    // Probe path only; ignore a failed write.
  }
}
recordMicrophoneStatus('boot');
import {
  defineCapability,
  deleteWorkspaceItem,
  renameWorkspaceItem,
  ediSetupCapabilities,
  fileCapabilities,
  macCapabilities,
  notesCapabilities,
  readLibraryNote,
  toArtifactContent,
  webCapabilities,
  workspaceCapabilities,
  type EdiPreferences,
  type EdiSetupSnapshot,
  type WorkspaceDependencies,
  type FileDependencies,
} from '@edi/capabilities';
import { macDependencies } from './platform/mac-actions';
import { ApprovalRules } from './agent/approval-rules';
import { ComposioCredentials } from './connectors/composio-credentials';
import { ConnectorManager } from './connectors/manager';
import { SkillLibrary } from './skills/library';
import { skillCapabilities } from './skills/capabilities';
import { builtInSkills } from '../shared/built-in-skills';
import {
  connectAppCapability,
  resumeWhenConnected,
  type WaitingRequest,
} from './connectors/connect-offer';
import { EncryptedSecretStore } from './connectors/secrets';
import {
  artifactExport,
  artifactPreview,
  exportFileName,
  exportFormatLabel,
  exportFormats,
  type ExportFormat,
  taskBudgetSchema,
  describeWhen,
  scheduleWhenSchema,
  assistantName,
  isCloudVoiceModel,
  voiceCatalog,
  voiceName,
  connectorCatalog,
  voiceSelectionSchema,
  type VoiceSelection,
  defaultCharacterId,
  replyMood,
  type Artifact,
  type ArtifactRef,
  type ArtifactSummary,
  type CloudProviderId,
  type CloudVoiceOption,
  type LibraryItem,
  type SystemInfo,
  type WorkspaceView,
  type SkillsState,
} from '@edi/contracts';
import { createRepositories, openDatabase } from '@edi/storage';
import { AgentService } from './agent/agent-service';
import { captureScreensForPrompt, showMarksInCaptures } from './capture/screens';
import { documentText, shouldHideCardOnBlur } from './permissions';
import type { PermissionManager } from './permission-manager';
import { MlxVoice } from './voice/mlx-process';
import { CARTESIA_MODEL, ELEVENLABS_MODEL, listCloudVoices, speakCloud } from './voice/cloud-voice';
import { VoiceKeys } from './voice/voice-keys';
import { progressLabel } from './agent/step-labels';
import { resolveVoiceRuntime } from './voice/runtime';
import { cartesiaTranscriber, streamCartesiaSpeech } from './voice/cartesia-realtime';
import { localTranscriber, WhisperServer } from './voice/transcription-server';
import { PersonalVoices, RECORDING_EXTENSIONS } from './voice/personal-voices';
import { transcriptionPrompt } from './voice/transcription-process';
import { speakable, spokenFailure, VoiceController } from './voice/voice-controller';
import { OpenRouterCredentials } from './agent/credentials';
import { ModelCatalog, readerModelFrom } from './agent/model-catalog';
import { FileAccessManager } from './platform/file-access';
import { TaskService } from './agent/task-service';
import { Scheduler } from './agent/scheduler';
import { captureDesktopContext } from './context/desktop-context';
import { OpenRouterAccount } from './agent/openrouter-account';
import { HoldHotkey, optionSpace, resolveHotkeyHelper } from './input/hold-hotkey';
import { PointerOverlay } from './presentation/pointer';
import { Annotations } from './presentation/annotations';
import { CharacterActions } from './character/character-actions';
import { sleepAfterReply } from './character/sleep-after-reply';
import { CharacterMoodController } from './character/character-mood';
import { CharacterLibrary } from './characters/library';
import { maxPackageBytes, packageExtension } from './characters/package-file';
import { createCommandRoutes } from './ipc/commands';
import { registerIpc } from './ipc/router';
import { PetDrag } from './character/pet-drag';
import { SettingsStore } from './settings/settings-store';
import { WindowPlacement } from './windows/placement';
import { ArtifactWindow } from './windows/artifact-window';
import { artifactSession, registerArtifactScheme } from './windows/artifact-sandbox';
import { createMacMediaPermissions } from './platform/macos-media-permissions';
import {
  broadcast,
  createCharacterMenuWindow,
  createAnnotationWindow,
  createPointerWindow,
  createPetWindow,
  createStatusBubbleWindow,
  createExportWindow,
  createWorkspaceWindow,
  resizePetWindow,
} from './windows/factory';
import { Exporter } from './exports/exporter';

/** Display tools whose successful calls become artifacts in the conversation. */
const DISPLAY_CAPABILITIES = ['workspace.show', 'notes.show'] as const;
/** A shortcut press shorter than this is a tap: it starts (or ends) a hands-free conversation. */
const TAP_MS = 350;
/** How long a request waits for an app the person agreed to connect. */
const WAIT_FOR_APP_MS = 15 * 60_000;

let quitting = false;

/**
 * Notes used to live in Documents › Edi Notes. Move that folder into the workspace once, and
 * repoint the records, so existing notes keep working. Leaves everything alone on any conflict.
 */
function moveLegacyNotes(
  legacy: string,
  target: string,
  store: { relocate(from: string, to: string): number },
) {
  try {
    if (!existsSync(legacy) || existsSync(target)) return;
    mkdirSync(join(target, '..'), { recursive: true });
    renameSync(legacy, target);
    store.relocate(legacy, target);
  } catch {
    // A failed move keeps the old folder; the records still point at it.
  }
}

/** A stored display call as a conversation card; malformed history is skipped. */
function summarizeShown(call: { id: string; capability: string; input: unknown; output: unknown }) {
  try {
    if (call.capability === 'workspace.show') {
      const content = toArtifactContent(call.input as Parameters<typeof toArtifactContent>[0]);
      return {
        id: call.id,
        kind: content.kind,
        title: content.title,
        preview: artifactPreview(content),
      } satisfies ArtifactSummary;
    }
    const noteId = String((call.input as { id?: unknown }).id ?? '');
    const title = String((call.output as { title?: unknown } | null)?.title ?? 'Note').slice(
      0,
      120,
    );
    return { id: call.id, kind: 'note', title, preview: '', noteId } satisfies ArtifactSummary;
  } catch {
    return null;
  }
}

/** Composition root: construct services, wire them together, own app lifecycle. */
async function start() {
  // One SQLite writer, owned here. Nothing in flight at the last quit is replayed.
  const database = openDatabase(join(app.getPath('userData'), 'edi.sqlite'));
  const repositories = createRepositories(database);
  repositories.recoverInterrupted(Date.now());

  const settings = new SettingsStore();
  await settings.load();
  // Built-in and installed characters. A saved character that is no longer installed falls
  // back to Edi.
  const characters = new CharacterLibrary(() => join(app.getPath('userData'), 'characters'));
  await characters.load();
  if (!characters.has(settings.current.skin)) await settings.update({ skin: defaultCharacterId });
  const currentCharacter = () => characters.get(settings.current.skin);
  /** What the companion is called: the person's name for it, or its character's. */
  const companion = () => assistantName(settings.current, currentCharacter().manifest.name);
  // One user-visible workspace. Structured generated content and human notes remain distinct.
  const workspaceFolder = join(app.getPath('documents'), 'Edi');
  // The person's own folders for the file tools (Settings → Privacy & Permissions).
  const fileAccess = new FileAccessManager(() => workspaceFolder);
  await fileAccess.load();
  const notesFolder = () => join(workspaceFolder, 'Notes');
  moveLegacyNotes(join(app.getPath('documents'), 'Edi Notes'), notesFolder(), repositories.notes);
  // Skills by Fewerlabs ship with Edi; the person's own live in Documents › Edi › Skills.
  const skillsFolder = () => join(workspaceFolder, 'Skills');
  const skills = new SkillLibrary({
    builtIn: builtInSkills,
    folder: skillsFolder,
    off: () => settings.current.skillsOff,
    setOff: async names => {
      await settings.update({ skillsOff: names });
    },
    trash: path => shell.trashItem(path),
  });
  await skills.refresh();
  const [useSkill, createSkill] = skillCapabilities(skills);
  const enabledSkills = () =>
    skills.enabled().map(({ name, description }) => ({ name, description }));
  const permissionPort: { current?: PermissionManager } = {};
  // Local speech/transcription assets are resolved before the agent so its setup skill
  // reports the same availability used by the voice controller.
  const voiceRuntime =
    process.env.EDI_VOICE === 'off' ? null : resolveVoiceRuntime(app.getAppPath(), app.isPackaged);
  // Chatterbox voices the person added from their own recordings, kept only in this Mac's app
  // data (Settings → Voice). Read once here and again whenever one is added or removed.
  const personalVoices = new PersonalVoices(join(app.getPath('userData'), 'voices/chatterbox'), {
    trash: path => shell.trashItem(path),
  });
  let personalVoiceList = await personalVoices.list();
  const personalReferences = () =>
    Object.fromEntries(
      personalVoiceList.map(voice => [voice.id, personalVoices.recording(voice.id)]),
    );
  // The MLX engines are created after the settings snapshot helpers; read them lazily.
  let kokoroVoice: MlxVoice | null = null;
  let chatterboxVoice: MlxVoice | null = null;
  const engineDetail = (engine: MlxVoice | null, base: string) => {
    if (engine?.status === 'loading') return `${base} Warming up on this Mac.`;
    const first = engine?.lastFirstAudioMs ?? null;
    if (engine?.status === 'ready' && first !== null)
      return `${base} Last reply started in ${(first / 1000).toFixed(1)}s.`;
    return base;
  };
  const voiceModels = (): SystemInfo['voice']['models'] => [
    {
      id: 'kokoro',
      name: 'Kokoro',
      available: Boolean(voiceRuntime?.mlx?.kokoro),
      expressions: false,
      detail: engineDetail(kokoroVoice, 'Natural, fast voices. The default.'),
    },
    {
      id: 'chatterbox-turbo',
      name: 'Chatterbox Turbo',
      available: Boolean(voiceRuntime?.mlx?.chatterbox),
      expressions: true,
      detail: engineDetail(chatterboxVoice, 'Expressive, with laughs and sighs.'),
      personalVoices: personalVoiceList,
    },
    {
      id: 'cartesia',
      name: 'Cartesia',
      available: voiceKeys.has('cartesia'),
      expressions: false,
      detail: voiceKeys.has('cartesia')
        ? 'Cloud voice (Sonic). Uses your Cartesia account.'
        : 'Cloud voice. Add your Cartesia key.',
    },
    {
      id: 'elevenlabs',
      name: 'ElevenLabs',
      available: voiceKeys.has('elevenlabs'),
      expressions: false,
      detail: voiceKeys.has('elevenlabs')
        ? 'Cloud voice (Flash). Uses your ElevenLabs account.'
        : 'Cloud voice. Add your ElevenLabs key.',
    },
  ];
  const voiceKeys = new VoiceKeys();
  await voiceKeys.load();
  // The last listing of each cloud account, so a chosen voice reads as its name ("Edi"), not its
  // id, in Settings and in what the agent knows. Refreshed at launch and whenever Settings lists.
  const cloudVoiceLists: Partial<Record<CloudProviderId, CloudVoiceOption[]>> = {};
  const loadCloudVoices = async (provider: CloudProviderId) => {
    const list = await listCloudVoices(
      provider,
      voiceKeys.get(provider),
      AbortSignal.timeout(15_000),
    );
    if (voiceKeys.has(provider)) cloudVoiceLists[provider] = list;
    return list;
  };
  for (const provider of ['cartesia', 'elevenlabs'] as const)
    if (voiceKeys.has(provider)) void loadCloudVoices(provider).catch(() => {});
  const spokenVoiceName = ({ model, voice }: VoiceSelection) => {
    const personal = personalVoiceList.find(entry => entry.id === voice);
    if (model === 'chatterbox-turbo' && personal) return personal.name;
    if (!isCloudVoiceModel(model)) return voiceName(model, voice);
    const listed = cloudVoiceLists[model]?.find(entry => entry.id === voice);
    return listed?.name ?? `Your ${model === 'cartesia' ? 'Cartesia' : 'ElevenLabs'} voice`;
  };
  /** The chosen model and voice; a cloud model without a key or voice falls back to Kokoro. */
  const selectedVoice = (): VoiceSelection => {
    const chosen = voiceSelectionSchema.safeParse({
      model: settings.current.voiceModel,
      voice: settings.current.voices[settings.current.voiceModel],
    });
    // A personal voice whose recording is gone speaks with the built-in Calm voice instead.
    if (
      chosen.success &&
      chosen.data.model === 'chatterbox-turbo' &&
      chosen.data.voice !== 'calm' &&
      chosen.data.voice !== 'turbo'
    )
      return personalVoiceList.some(voice => voice.id === chosen.data.voice)
        ? chosen.data
        : { model: 'chatterbox-turbo', voice: 'calm' };
    if (
      chosen.success &&
      (!isCloudVoiceModel(chosen.data.model) || voiceKeys.has(chosen.data.model))
    )
      return chosen.data;
    return { model: 'kokoro', voice: settings.current.voices.kokoro };
  };
  let openSetup = (_page: WorkspaceView) => {};
  // Filled in once windows exist; capabilities call these lazily.
  let showArtifact = (_artifact: ArtifactSummary) => {};
  let applyPreferences = async (_patch: EdiPreferences) => {};
  let windowAction = (_action: 'close' | 'sleep') => {};
  let cardOpen = () => false;
  let connectedApps = () => '';
  let connectorSummary = (): Pick<EdiSetupSnapshot, 'connectors' | 'appsToConnect'> => ({
    connectors: [],
    appsToConnect: [],
  });
  let currentView: WorkspaceView = 'home';
  let pushToTalk = (): EdiSetupSnapshot['current']['pushToTalk'] => ({
    status: 'starting',
    shortcut: '⌥ Space',
  });
  // Assigned once below; the setup snapshot closure reads it after construction.
  // eslint-disable-next-line prefer-const
  let agent!: AgentService;
  /** One set of workspace dependencies for Edi's tools and the Library's own Delete. */
  const workspaceDeps: WorkspaceDependencies = {
    directory: () => workspaceFolder,
    shown: artifact => showArtifact(artifact),
    artifacts: repositories.artifacts,
    notes: { store: repositories.notes, directory: notesFolder },
    // Recoverable: files go to the Trash, never straight to deletion.
    trash: path => shell.trashItem(path),
    conversations: repositories.conversations,
    // Assigned below with the export page; only called once Edi is running.
    exportItem: (ref, format) => exporter.export(ref, format),
  };
  const libraryItems = (): LibraryItem[] => {
    const notes: LibraryItem[] = repositories.notes
      .list(500)
      .map(({ id, title, bytes, createdAt, pinnedAt }) => ({
        id,
        kind: 'note',
        title,
        bytes,
        createdAt,
        pinned: Boolean(pinnedAt),
        regenerable: false,
      }));
    const artifacts: LibraryItem[] = repositories.artifacts
      .list(500)
      .map(({ id, kind, title, bytes, updatedAt, pinnedAt }) => ({
        id,
        kind,
        title,
        bytes,
        createdAt: updatedAt,
        pinned: Boolean(pinnedAt),
        regenerable: Boolean(repositories.toolCalls.origin(id)?.prompt.trim()),
      }));
    return [...notes, ...artifacts].sort((a, b) => b.createdAt - a.createdAt).slice(0, 500);
  };
  const setupSnapshot = (): EdiSetupSnapshot => {
    const character = currentCharacter().manifest;
    const selectedModel =
      voiceModels().find(item => item.id === settings.current.voiceModel) ?? voiceModels()[0]!;
    const speaking = selectedVoice();
    const items = libraryItems();
    const notes = items.filter(item => item.kind === 'note');
    return {
      identity: {
        name: companion(),
        customName: settings.current.name !== null,
        app: 'Edi',
        version: app.getVersion(),
      },
      location: { page: currentView, cardOpen: cardOpen(), pinned: settings.current.pinned },
      workspace: {
        root: workspaceFolder,
        generatedContent: join(workspaceFolder, 'Artifacts'),
        behavior:
          'Generated content is saved automatically and opens in its own window beside the card.',
      },
      library: {
        items: items.length,
        notes: notes.length,
        artifacts: items.length - notes.length,
        recent: items.slice(0, 8).map(({ id, title }) => ({ id, title })),
      },
      abilities: [
        { name: 'Answer questions, including about what is on screen', asksFirst: false },
        {
          name: 'Know the app, window, page address, open document and selected text in front when asked (Settings → Privacy & Permissions)',
          asksFirst: false,
        },
        {
          name: 'Search the public web for current information and link the sources it used',
          asksFirst: false,
        },
        {
          name: 'Create documents, checklists, tables and sandboxed interactive pages, save them to the workspace and show them in their own window',
          asksFirst: false,
        },
        { name: 'Search and read everything in the workspace', asksFirst: false },
        { name: 'Save or edit notes, and update generated content', asksFirst: true },
        { name: 'Move workspace items to the Trash', asksFirst: true },
        {
          name: 'Search, list and read files in allowed folders (Desktop, Documents, Downloads, added folders)',
          asksFirst: false,
        },
        {
          name: 'Rename, move, create folders and move files to the Trash in allowed folders',
          asksFirst: true,
        },
        {
          name: 'Open apps, links in the browser and files in allowed folders; show files in Finder',
          asksFirst: true,
        },
        {
          name: 'Read and add Reminders and Calendar events (Settings → Privacy & Permissions)',
          asksFirst: true,
        },
        {
          name: `Use connected apps (Connectors)${connectedApps() ? `: ${connectedApps()}` : ', none connected yet'}`,
          asksFirst: true,
        },
        {
          name: 'Use skills (ways of working, listed in Skills) and make new ones with Skill Creator',
          asksFirst: true,
        },
        { name: 'Open any page in Edi, including Settings', asksFirst: false },
        {
          name: 'Change its character, size, pin, voice and whether replies are spoken',
          asksFirst: false,
        },
        { name: 'Close its card or go to sleep', asksFirst: false },
        {
          name: 'Run longer work as background tasks with a spending cap, and report how they are going',
          asksFirst: true,
        },
        {
          name: 'Schedule tasks for later or on repeat, and watch things, telling you only when they change',
          asksFirst: true,
        },
        { name: 'Point at and draw on the screen', asksFirst: false },
      ],
      notYetAvailable: [
        'Installing skills from a community catalog',
        'Clicking or typing in other apps',
        'Opening, reading or using logged-in websites in a browser',
        'Changing the keyboard shortcut',
      ],
      current: {
        size: settings.current.petScale,
        character: { id: character.id, name: character.name },
        voice: {
          id: selectedModel.id,
          name: selectedModel.name,
          speakingVoice: { id: speaking.voice, name: spokenVoiceName(speaking) },
          available: selectedModel.available,
          expressions: selectedModel.expressions,
          detail: selectedModel.detail,
          status:
            selectedModel.id === 'chatterbox-turbo'
              ? (chatterboxVoice?.status ?? 'off')
              : selectedModel.id === 'kokoro'
                ? (kokoroVoice?.status ?? 'off')
                : selectedModel.available
                  ? 'ready'
                  : 'unavailable',
        },
        speakReplies: settings.current.speakReplies,
        ai: { connected: agent?.state.configured ?? false, model: agent?.state.model || null },
        pushToTalk: pushToTalk(),
      },
      // Built-in abilities are listed above; skills are add-ons, and none exist yet.
      skills: skills.list().map(skill => ({
        id: skill.name,
        name: skill.title,
        active: skill.enabled,
      })),
      ...connectorSummary(),
      permissions: (permissionPort.current?.snapshot().permissions ?? []).map(({ id, status }) => ({
        id,
        status,
      })),
      availableCharacters: characters.list().map(({ manifest }) => ({
        id: manifest.id,
        name: manifest.name,
      })),
      availableVoices: voiceModels().map(({ id, name, available, expressions, detail }) => ({
        id,
        name,
        available,
        expressions,
        detail,
        voices: isCloudVoiceModel(id)
          ? (cloudVoiceLists[id] ?? []).map(({ id: voice, name: voiceLabel, gender, accent }) => ({
              id: voice,
              name: voiceLabel,
              gender,
              accent,
            }))
          : voiceCatalog[id].map(voice => ({ ...voice })),
      })),
    };
  };
  // EDI_MODEL_CATALOG=off keeps automated desktop tests off the network.
  const modelCatalog =
    process.env.EDI_MODEL_CATALOG === 'off'
      ? { list: () => Promise.reject(new Error('Model catalog disabled.')) }
      : new ModelCatalog();
  // Web pages are read by the newest Gemini Flash Lite in OpenRouter's catalog (cached an hour).
  let readerModel: string | null = null;
  const refreshReaderModel = () =>
    void modelCatalog
      .list()
      .then(models => {
        readerModel = readerModelFrom(models) ?? readerModel;
      })
      .catch(() => {});
  refreshReaderModel();
  const openRouter = new OpenRouterCredentials();
  const openRouterAccount = new OpenRouterAccount();
  const fileDeps: FileDependencies = {
    home: app.getPath('home'),
    roots: () => fileAccess.roots(),
    workspace: workspaceFolder,
    trash: path => shell.trashItem(path),
    accessResult: (root, allowed) => fileAccess.record(root, allowed),
    ...(process.platform === 'darwin'
      ? { documentText: path => documentText(path) ?? Promise.resolve(null) }
      : {}),
  };
  const macTools = macCapabilities(macDependencies(fileDeps));
  // Edi's tools. Background tasks get the same ones except starting tasks and controlling Edi.
  const toolCapabilities = [
    useSkill,
    ...notesCapabilities({
      directory: notesFolder,
      store: repositories.notes,
      shown: artifact => showArtifact(artifact),
    }),
    ...workspaceCapabilities(workspaceDeps),
    ...fileCapabilities(fileDeps),
    // Background tasks may use Reminders and Calendar; opening things is for the person present.
    ...macTools.filter(tool => !tool.id.startsWith('mac.')),
    ...webCapabilities({
      // A link the person typed is read on their behalf; robots.txt applies to the model's picks.
      suppliedByUser: url => {
        const target = url.replace(/^http:/, 'https:').replace(/#.*$/, '');
        return agent.state.messages.some(
          message =>
            message.role === 'user' &&
            message.text.replace(/http:\/\//g, 'https://').includes(target),
        );
      },
    }),
  ];
  const ediTools = [
    ...ediSetupCapabilities({
      snapshot: setupSnapshot,
      open: page => openSetup(page),
      change: patch => applyPreferences(patch),
      window: action => windowAction(action),
    }),
  ];
  const taskTools = [
    defineCapability({
      id: 'tasks.start',
      title: 'Start a background task',
      description:
        'Hand longer work to a background task that keeps running while the user does other ' +
        'things: research across many pages, comparing options, organizing lots of files, ' +
        'drafting a report. Use it when the user asks for something to happen in the background ' +
        'or while they work, or when the work clearly needs many steps. Give a short title and ' +
        'complete instructions (the task cannot ask questions). Pass budgetUsd only when the user ' +
        'named an amount; otherwise their default cap applies. Then tell the user it is running ' +
        'and that they can follow it in Tasks.',
      effect: 'write',
      timeoutMs: 5_000,
      input: z
        .object({
          title: z.string().trim().min(1).max(80).describe('A short name for the task'),
          instructions: z
            .string()
            .trim()
            .min(1)
            .max(8000)
            .describe('Everything the task needs to know, written as a request'),
          budgetUsd: taskBudgetSchema
            .optional()
            .describe('Spending cap in US dollars, only if the user named one'),
        })
        .strict(),
      prepare({ title, instructions, budgetUsd }) {
        const budget = budgetUsd ?? settings.current.taskBudgetUsd;
        return {
          preview: {
            title: 'Start a background task',
            action: 'Start Task',
            summary: `Work on “${title}” in the background, spending up to $${budget.toFixed(2)}.`,
            fields: [{ label: 'Spending cap', value: `$${budget.toFixed(2)}` }],
            body: instructions.slice(0, 4000),
          },
          async execute() {
            const task = tasks.start({
              prompt: instructions,
              title,
              budgetUsd: budget,
              conversationId: agent.state.conversationId,
            });
            return {
              summary: `Started “${task.title}” in the background (up to $${budget.toFixed(2)}).`,
              output: { taskId: task.id, status: task.status },
            };
          },
        };
      },
    }),
    defineCapability({
      id: 'tasks.list',
      title: 'Check background tasks',
      description:
        'See background tasks: status, progress, spending, and the results of finished ones. Use ' +
        'it when the user asks how a task is going or what it found.',
      effect: 'read',
      timeoutMs: 5_000,
      input: z.object({}).strict(),
      prepare() {
        return {
          preview: { title: 'Check tasks', action: 'Check', summary: 'Check tasks.', fields: [] },
          async execute() {
            const list = tasks.list(10).map(task => ({
              title: task.title,
              status: task.status,
              progress: task.progress,
              spent: `$${task.spentUsd.toFixed(2)} of $${task.budgetUsd.toFixed(2)}`,
              result: task.result.slice(0, 2000),
              error: task.error,
            }));
            return {
              summary: list.length === 1 ? '1 task.' : `${list.length} tasks.`,
              output: { tasks: list },
            };
          },
        };
      },
    }),
    defineCapability({
      id: 'schedules.create',
      title: 'Schedule a task',
      description:
        'Run a task later or repeatedly, as a background task each time: “every weekday at 9 ' +
        'summarize my tech news”, “tomorrow at 3pm check the order status”, “every 4 hours”. For ' +
        '“tell me when X changes” make it a watch (notify on-change): it compares each check with ' +
        'the last and only tells the user when something changed. Instructions must stand on ' +
        'their own. Use local times. Pass budgetUsd only when the user named an amount per run.',
      effect: 'write',
      timeoutMs: 5_000,
      input: z
        .object({
          title: z.string().trim().min(1).max(80).describe('A short name'),
          instructions: z.string().trim().min(1).max(8000).describe('What each run should do'),
          when: scheduleWhenSchema.describe(
            'once {at: "YYYY-MM-DDTHH:MM"}, daily {time: "HH:MM", days?: ["mon",…]} or every {hours}',
          ),
          notify: z
            .enum(['always', 'on-change'])
            .describe('always: tell the user each result; on-change: a watch'),
          budgetUsd: taskBudgetSchema
            .optional()
            .describe('Spending cap per run, if the user named one'),
        })
        .strict(),
      prepare({ title, instructions, when, notify, budgetUsd }) {
        const budget = budgetUsd ?? settings.current.taskBudgetUsd;
        const rhythm = describeWhen(when);
        return {
          preview: {
            title: notify === 'on-change' ? 'Start a watch' : 'Schedule a task',
            action: notify === 'on-change' ? 'Start Watch' : 'Schedule',
            summary: `${rhythm}: “${title}”, up to $${budget.toFixed(2)} each time.`,
            fields: [
              { label: 'When', value: rhythm },
              {
                label: 'Tells you',
                value: notify === 'on-change' ? 'Only when something changes' : 'Each result',
              },
            ],
            body: instructions.slice(0, 4000),
          },
          async execute() {
            const schedule = scheduler.create({
              title,
              prompt: instructions,
              when,
              notify,
              budgetUsd: budget,
            });
            return {
              summary: `${notify === 'on-change' ? 'Watching' : 'Scheduled'} “${schedule.title}”: ${rhythm.toLowerCase()}.`,
              output: {
                scheduleId: schedule.id,
                nextRun: schedule.nextRunAt ? new Date(schedule.nextRunAt).toString() : null,
              },
            };
          },
        };
      },
    }),
    defineCapability({
      id: 'schedules.list',
      title: 'Check schedules',
      description:
        'List schedules and watches: what they do, when they run next, and their latest result. ' +
        'Use it before changing or removing one, or when the user asks what is scheduled.',
      effect: 'read',
      timeoutMs: 5_000,
      input: z.object({}).strict(),
      prepare() {
        return {
          preview: {
            title: 'Check schedules',
            action: 'Check',
            summary: 'Check schedules.',
            fields: [],
          },
          async execute() {
            const list = scheduler.list().map(schedule => ({
              id: schedule.id,
              title: schedule.title,
              when: describeWhen(schedule.when),
              watch: schedule.notify === 'on-change',
              enabled: schedule.enabled,
              nextRun: schedule.nextRunAt ? new Date(schedule.nextRunAt).toString() : null,
              latest: schedule.lastResult.slice(0, 1000),
            }));
            return {
              summary: list.length === 1 ? '1 schedule.' : `${list.length} schedules.`,
              output: { schedules: list },
            };
          },
        };
      },
    }),
    defineCapability({
      id: 'schedules.delete',
      title: 'Remove a schedule',
      description: 'Stop and remove a schedule or watch by id from schedules_list.',
      effect: 'write',
      timeoutMs: 5_000,
      input: z.object({ id: z.string().uuid() }).strict(),
      prepare({ id }) {
        const schedule = repositories.schedules.get(id);
        if (!schedule) throw new Error('That schedule no longer exists.');
        return {
          preview: {
            title: 'Remove a schedule',
            action: 'Remove',
            summary: `Stop “${schedule.title}” (${describeWhen(schedule.when).toLowerCase()}).`,
            fields: [],
          },
          async execute() {
            scheduler.remove(id);
            return { summary: `Removed “${schedule.title}”.` };
          },
        };
      },
    }),
  ];
  const approvalRules = new ApprovalRules(repositories);
  const composioCredentials = new ComposioCredentials();
  await composioCredentials.load();
  const connectors = new ConnectorManager({
    repositories,
    secrets: new EncryptedSecretStore(join(app.getPath('userData'), 'connectors'), {
      available: () => safeStorage.isEncryptionAvailable(),
      encrypt: text => safeStorage.encryptString(text),
      decrypt: data => safeStorage.decryptString(data),
    }),
    composioCredentials,
    openBrowser: url => shell.openExternal(url, { activate: true }),
    version: app.getVersion(),
  });
  connectedApps = () =>
    connectors
      .list()
      .filter(connector => connector.status === 'connected')
      .map(connector => connector.name)
      .join(', ');
  // Short-list apps the model may offer to connect: not connected yet, and reachable (Composio
  // apps only once the person's Composio key is saved).
  const appsToConnect = () => {
    const connected = new Set(
      connectors
        .list()
        .filter(connector => connector.status === 'connected')
        .map(connector => connector.catalogId),
    );
    return connectorCatalog
      .filter(
        entry =>
          !connected.has(entry.id) &&
          (entry.provider !== 'composio' || composioCredentials.configured),
      )
      .map(({ id, name }) => ({ id, name }));
  };
  connectorSummary = () => ({
    connectors: connectors.list().map(connector => ({
      id: connector.catalogId ?? connector.id,
      name: connector.name,
      active: connector.status === 'connected',
    })),
    appsToConnect: appsToConnect(),
  });
  const continueAfterConnecting = async (waiting: WaitingRequest) => {
    if (agent.state.status === 'running')
      await new Promise<void>(resolve => {
        const stop = agent.onChange(state => {
          if (state.status === 'running') return;
          stop();
          resolve();
        });
      });
    const runId = await agent
      .ask(
        `${waiting.app.name} is connected now. Continue my earlier request: ${waiting.request}`,
        {
          conversationId: waiting.conversationId,
          note: `${waiting.app.name} is connected. Continuing your request.`,
        },
      )
      .catch(() => undefined);
    if (runId) character.showContent();
  };
  // Once an app the person agreed to connect is live, Edi continues their request in the same
  // conversation; whatever it then wants to do is reviewed as usual.
  const waitingOnApps = resumeWhenConnected({
    onChange: listener => connectors.onChange(listener),
    continueRequest: waiting => void continueAfterConnecting(waiting),
    waitMs: WAIT_FOR_APP_MS,
  });
  const connectApp = connectAppCapability({
    available: appsToConnect,
    start: appId => connectors.add({ catalogId: appId }),
    resumeAfter: (connectionId, app, request, runId) => {
      const conversationId = agent.conversationOfRun(runId);
      if (conversationId) waitingOnApps.wait(connectionId, { conversationId, app, request });
    },
  });
  const tasks = new TaskService({
    rules: approvalRules,
    connectedTools: () => connectors.capabilities(),
    credentials: openRouter,
    repositories,
    capabilities: toolCapabilities,
    selfContext: () => JSON.stringify(setupSnapshot()),
    skills: enabledSkills,
    assistantName: () => companion(),
    readerModel: () => readerModel,
    finished: task => {
      // Scheduled runs speak through the scheduler: watches stay quiet unless something changed.
      if (scheduler.finished(task)) return;
      if (cardOpen()) return;
      character.showVoiceStatus({
        notice:
          task.status === 'done'
            ? `Finished: ${task.title}`
            : task.status === 'failed'
              ? `Couldn’t finish: ${task.title}`
              : `Stopped: ${task.title}`,
      });
    },
  });
  const scheduler = new Scheduler({
    repositories,
    tasks,
    notify: (schedule, task, summary) => {
      const watch = schedule.notify === 'on-change';
      if (!cardOpen())
        character.showVoiceStatus({
          notice: `${watch ? 'Changed' : 'Ready'}: ${schedule.title}`,
        });
      // Results can arrive while the person is away, so they also go to Notification Center.
      if (Notification.isSupported()) {
        const note = new Notification({
          title: watch ? `${schedule.title} changed` : schedule.title,
          body: summary.replace(/\s+/g, ' ').slice(0, 180) || `${task.title} is ready.`,
          silent: true,
        });
        note.on('click', () => openSetup('tasks'));
        note.show();
      }
    },
  });
  agent = new AgentService({
    rules: approvalRules,
    connectedTools: () => connectors.capabilities(),
    readerModel: () => {
      refreshReaderModel();
      return readerModel;
    },
    desktopContext: async () =>
      settings.current.shareDesktopContext ? captureDesktopContext() : null,
    credentials: openRouter,
    repositories,
    capabilities: [
      ...toolCapabilities,
      ...macTools.filter(tool => tool.id.startsWith('mac.')),
      ...taskTools,
      ...ediTools,
      connectApp,
      createSkill,
    ],
    threadArtifacts: runIds => {
      const byRun = new Map<string, ArtifactSummary[]>();
      for (const call of repositories.toolCalls.shown(DISPLAY_CAPABILITIES, { runIds })) {
        // Deleted content leaves the conversation too; updated content shows its current title.
        const record =
          call.capability === 'workspace.show' ? repositories.artifacts.get(call.id) : null;
        if (call.capability === 'workspace.show' && !record) continue;
        const summary = record
          ? (() => {
              try {
                const content = toArtifactContent(
                  record.content as Parameters<typeof toArtifactContent>[0],
                );
                return {
                  id: record.id,
                  kind: content.kind,
                  title: content.title,
                  preview: artifactPreview(content),
                } satisfies ArtifactSummary;
              } catch {
                return null;
              }
            })()
          : summarizeShown(call);
        if (summary) byRun.set(call.runId, [...(byRun.get(call.runId) ?? []), summary].slice(-6));
      }
      return byRun;
    },
    captureScreens: captureScreensForPrompt,
    screenPermissionRequired: () => permissionPort.current?.require('screen-recording'),
    point: target => pointer.show(target),
    selfContext: () => JSON.stringify(setupSnapshot()),
    skills: enabledSkills,
    assistantName: () => companion(),
  });
  await agent.load();

  const workspace = createWorkspaceWindow();
  const pet = createPetWindow(settings.current.petPosition, settings.current.petScale);
  cardOpen = () => !workspace.isDestroyed() && workspace.isVisible();
  const pointer = new PointerOverlay({
    pet,
    character: () => currentCharacter().manifest,
    create: createPointerWindow,
  });
  // The person's own marks: drawing while Edi listens says “this bit” better than a cursor can.
  const annotations = new Annotations({
    displayUnderCursor: () => {
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      return { id: display.id, ...display.bounds };
    },
    create: (display, params) => createAnnotationWindow(display, params),
    accent: () => currentCharacter().manifest.colors.accent,
  });
  // Their marks stay in the picture Edi takes; every other Edi window stays out of it.
  showMarksInCaptures({ marks: () => annotations.current(), windows: () => annotations.captured });
  // Shown content opens in its own window beside the card. Focus may move between the two
  // without either hiding; leaving both (unless pinned) hides them together.
  const artifactWindow = new ArtifactWindow(
    () => ({ card: workspace.getBounds(), pet: pet.getBounds() }),
    () => hideOnBlur(),
    () =>
      artifactSession(async callId => {
        const content = await resolveArtifact({ callId });
        return content.kind === 'html' ? content.html : null;
      }),
  );
  const hideOnBlur = () =>
    setTimeout(() => {
      const focused = BrowserWindow.getFocusedWindow();
      if (focused && (focused === workspace || focused === artifactWindow.window)) return;
      if (shouldHideCardOnBlur(settings.current.pinned, mediaPermissions.holdsCardOpen())) {
        workspace.hide();
        artifactWindow.hide();
      }
    }, 0);
  const placement = new WindowPlacement(
    pet,
    workspace,
    () => currentCharacter().manifest.geometry,
    () => artifactWindow.follow(),
  );
  const petDrag = new PetDrag(
    pet,
    () => placement.place(),
    petPosition => settings.update({ petPosition }),
  );
  const mlx = voiceRuntime?.mlx ?? null;
  // Warm engines stay loaded for an hour while selected; Kokoro is small and also stands in
  // while Chatterbox loads.
  const kokoro = mlx?.kokoro
    ? new MlxVoice(
        mlx,
        { id: 'kokoro', model: mlx.kokoro, label: 'Kokoro', voice: settings.current.voices.kokoro },
        { idleMs: 60 * 60_000 },
      )
    : null;
  const chatterbox = mlx?.chatterbox
    ? new MlxVoice(
        mlx,
        {
          id: 'chatterbox-turbo',
          model: mlx.chatterbox,
          label: 'Chatterbox Turbo',
          references: personalReferences,
        },
        { idleMs: 60 * 60_000 },
      )
    : null;
  kokoroVoice = kokoro;
  chatterboxVoice = chatterbox;
  type Consume = (pcm: Float32Array, rate: number) => Promise<void>;
  /** Speak with one exact model and voice. Only Chatterbox understands [laugh]-style tags. */
  const speakWith = (
    selection: VoiceSelection,
    text: string,
    signal: AbortSignal,
    consume: Consume,
  ) => {
    if (selection.model === 'chatterbox-turbo' && chatterbox)
      return chatterbox.speak(text, signal, consume, { voice: selection.voice });
    if (selection.model === 'kokoro' && kokoro)
      return kokoro.speak(speakable(text, false), signal, consume, { voice: selection.voice });
    if (isCloudVoiceModel(selection.model) && voiceKeys.has(selection.model)) {
      const provider = selection.model;
      const words = speakable(text, false);
      // Cloud voices bill characters on the person's plan; count them once the reply streamed
      // or was cut off (the provider already generated it).
      const record = () => {
        try {
          repositories.usage.add(
            {
              kind: 'voice',
              provider,
              model: provider === 'cartesia' ? CARTESIA_MODEL : ELEVENLABS_MODEL,
              inputTokens: 0,
              outputTokens: 0,
              cachedTokens: 0,
              costUsd: null,
              characters: words.length,
            },
            Date.now(),
          );
        } catch {
          // Usage records are best effort; speech never fails because of them.
        }
      };
      return speakCloud(
        provider,
        voiceKeys.get(provider),
        selection.voice,
        words,
        signal,
        consume,
      ).then(record, (error: unknown) => {
        if (signal.aborted) record();
        throw error;
      });
    }
    return Promise.reject(new Error('That voice is not installed on this Mac.'));
  };
  const standIn = (): VoiceSelection | null =>
    kokoro ? { model: 'kokoro', voice: settings.current.voices.kokoro } : null;
  const warmSelected = () => {
    const model = settings.current.voiceModel;
    if (model === 'chatterbox-turbo') {
      chatterbox?.warm();
      kokoro?.warm();
    } else kokoro?.warm(); // Kokoro, or the local stand-in for a cloud voice
  };
  const expressiveReady = () =>
    settings.current.voiceModel === 'chatterbox-turbo' && chatterbox?.status === 'ready';
  // Whisper stays loaded between turns (and pause checks) instead of starting for each one.
  const whisper = voiceRuntime
    ? new WhisperServer(voiceRuntime.transcription, voiceRuntime.transcriptionServer, {
        // The person's words, and the end of Edi's last reply so follow-ups spell its names.
        prompt: () =>
          transcriptionPrompt({
            name: companion(),
            words: settings.current.voiceWords,
            context: speakable(
              agent.state.messages.findLast(message => message.role === 'assistant')?.text ?? '',
            ),
          }),
        idleMs: 30 * 60_000,
        gpu: voiceRuntime.transcriptionGpu,
      })
    : null;
  const transcribeLocally = (pcm: Uint8Array, signal: AbortSignal) => {
    if (!whisper) return Promise.reject(new Error('Transcription is not installed.'));
    return whisper.transcribe(pcm, signal);
  };
  const voice = new VoiceController({
    runtime: voiceRuntime,
    send: event => broadcast([pet], 'edi:voice', event),
    status: status => character.showVoiceStatus(status),
    microphoneAccess: async () => permissionPort.current?.require('microphone') ?? false,
    captureScreens: captureScreensForPrompt,
    ask: (prompt, options) =>
      agent.ask(prompt, options).catch((error: unknown) => {
        if (error instanceof Error && error.message === 'Set up OpenRouter first.')
          placement.reveal();
        throw error;
      }),
    whenFinished: (runId, signal, onUpdate) => agent.whenFinished(runId, signal, onUpdate),
    stopAgent: () => agent.stop(),
    // Cartesia recognition only with its key; any failure falls back to whisper for the same audio.
    listen: () =>
      settings.current.voiceInput === 'cartesia' && voiceKeys.has('cartesia')
        ? cartesiaTranscriber(voiceKeys.get('cartesia'), transcribeLocally)
        : localTranscriber(transcribeLocally),
    // A Cartesia reply is one stream: sentences go in as the model writes them.
    speechStream: (signal, consume) => {
      const selected = selectedVoice();
      if (selected.model !== 'cartesia' || !voiceKeys.has('cartesia')) return null;
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(selected.voice)) return null;
      const stream = streamCartesiaSpeech(
        voiceKeys.get('cartesia'),
        selected.voice,
        signal,
        consume,
      );
      let recorded = false;
      // Characters are billed once generated, including a reply that was cut off.
      const record = () => {
        if (recorded || !stream.characters) return;
        recorded = true;
        try {
          repositories.usage.add(
            {
              kind: 'voice',
              provider: 'cartesia',
              model: CARTESIA_MODEL,
              inputTokens: 0,
              outputTokens: 0,
              cachedTokens: 0,
              costUsd: null,
              characters: stream.characters,
            },
            Date.now(),
          );
        } catch {
          // Usage records are best effort; speech never fails because of them.
        }
      };
      signal.addEventListener('abort', record, { once: true });
      return {
        say: text => stream.say(text),
        get failed() {
          return stream.failed;
        },
        end: () => stream.end().finally(record),
      };
    },
    speak: async (text, signal, consume) => {
      warmSelected();
      const selected = selectedVoice();
      // Chatterbox answers once loaded; until then Kokoro keeps the reply prompt.
      const chosen =
        selected.model === 'chatterbox-turbo' && chatterbox?.status !== 'ready'
          ? standIn()
          : selected;
      if (!chosen) throw new Error('No voice');
      let delivered = false;
      try {
        await speakWith(chosen, text, signal, (pcm, rate) => {
          delivered = true;
          return consume(pcm, rate);
        });
      } catch (error) {
        // A failed engine hands the reply to a local voice, but never repeats audio already heard.
        const backup = standIn();
        if (signal.aborted || delivered || !backup || backup.model === chosen.model) throw error;
        await speakWith(backup, text, signal, consume);
      }
    },
    warmSpeech: () => {
      warmSelected();
      whisper?.warm();
    },
    speakReplies: () => settings.current.speakReplies,
    expressiveVoice: expressiveReady,
    companionName: companion,
  });
  // Engines take seconds to load. Start now, not after the reply is on screen.
  warmSelected();
  const previewVoice = async (selection: VoiceSelection) => {
    const name = spokenVoiceName(selection);
    const self = companion();
    const sample =
      selection.model === 'chatterbox-turbo'
        ? `Hi, I'm ${self}. [chuckle] This is how I sound with ${name}.`
        : `Hi, I'm ${self}. This is how I sound as ${name}.`;
    const played = await voice.preview(
      sample,
      (words, signal, consume) => speakWith(selection, words, signal, consume),
      selection.model === 'chatterbox-turbo',
    );
    if (!played) throw new Error(`${companion()} is using its voice right now.`);
  };

  const mediaPermissions = createMacMediaPermissions({
    workspace,
    pet,
    voice,
    revealPermissionCard: () => placement.reveal(),
    onChange: snapshot => broadcast([workspace], 'edi:permissions', snapshot),
  });
  const permissions = mediaPermissions.manager;
  permissionPort.current = permissions;
  const mood = new CharacterMoodController(value => broadcast([pet], 'edi:character-mood', value));
  pet.webContents.on('did-finish-load', () =>
    pet.webContents.send('edi:character-mood', mood.current),
  );
  const character = new CharacterActions({
    pet,
    card: workspace,
    character: () => currentCharacter().manifest,
    name: () => companion(),
    startVoice: mode => voice.start(mode),
    showContent: () => placement.show(),
    openSettings: () => {
      workspace.webContents.send('edi:navigate', 'settings');
      placement.show();
    },
    stopWork: () => {
      pointer.dismiss();
      petDrag.cancel();
      voice.stop();
      agent.stop();
    },
    createBubble: createStatusBubbleWindow,
    createMenu: createCharacterMenuWindow,
    showExpression: expression => broadcast([pet], 'edi:character-expression', expression),
    noteActivity: () => mood.noteActivity(),
    quit: () => app.quit(),
  });

  // Global hold-to-talk: the same turn as holding the character, and it wakes Edi
  // from Sleep. Only while voice works, so ⌥ Space is left alone otherwise. A quick tap
  // (nothing said) keeps listening hands-free; a tap during that conversation ends it.
  let pressedAt = 0;
  let conversingAtPress = false;
  const hotkey = new HoldHotkey(
    voice.available
      ? resolveHotkeyHelper(app.getAppPath(), app.isPackaged, process.resourcesPath)
      : null,
    optionSpace,
    {
      down: () => {
        pressedAt = Date.now();
        conversingAtPress = voice.mode === 'conversation';
        pet.showInactive();
        // Held: a drag now draws on their screen instead of reaching the app underneath.
        annotations.arm();
        character.requestListening('push-to-talk');
      },
      up: () => {
        annotations.release();
        const tap = Date.now() - pressedAt < TAP_MS;
        if (tap && !conversingAtPress && voice.converse()) return;
        if (voice.phase !== 'idle') voice.release();
        else character.releaseListening();
      },
    },
  );
  pushToTalk = () => ({ status: hotkey.status, shortcut: '⌥ Space' });
  hotkey.start();

  openSetup = page => {
    workspace.webContents.send('edi:navigate', page);
    placement.show();
  };
  // Content opens in its own window beside the card, like an artifact panel, so the
  // conversation stays in view. A voice turn with the card closed gets a compact preview first.
  const openArtifact = (ref: ArtifactRef) => {
    character.clearArtifact();
    placement.place();
    artifactWindow.open(ref);
  };
  const artifactAction = async (action: 'copy' | 'reveal', ref: ArtifactRef) => {
    if (action === 'reveal') return shell.showItemInFolder(artifactPath(ref));
    clipboard.writeText(artifactExport(await resolveArtifact(ref)).copy);
  };
  showArtifact = artifact => {
    // A background task's content goes quietly to Library and its task, not onto the screen.
    if (tasks.owns(artifact.id)) return;
    agent.addArtifact(artifact);
    if (agent.runningSpoken && !cardOpen()) character.showArtifact(artifact);
    else openArtifact({ callId: artifact.id });
  };
  applyPreferences = async patch => {
    if (patch.character && !characters.has(patch.character))
      throw new Error('That character is not installed. Check availableCharacters.');
    if (patch.voice && !voiceModels().find(model => model.id === patch.voice)?.available)
      throw new Error('That voice model is not installed on this Mac.');
    const model = patch.voice ?? settings.current.voiceModel;
    const speakingVoice = patch.speakingVoice
      ? voiceSelectionSchema.safeParse({ model, voice: patch.speakingVoice })
      : null;
    if (
      (speakingVoice && !speakingVoice.success) ||
      (speakingVoice?.success &&
        isCloudVoiceModel(model) &&
        !cloudVoiceLists[model]?.some(entry => entry.id === speakingVoice.data.voice))
    )
      throw new Error(`That voice is not one of ${model}'s voices. Check availableVoices.`);
    if (patch.size !== undefined) {
      const geometry = characters.get(patch.character ?? settings.current.skin).manifest.geometry;
      const bounds = resizePetWindow(pet, patch.size, geometry);
      await settings.update({ petScale: patch.size, petPosition: { x: bounds.x, y: bounds.y } });
    }
    await settings.update({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.character ? { skin: patch.character } : {}),
      ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
      ...(patch.speakReplies !== undefined ? { speakReplies: patch.speakReplies } : {}),
      ...(patch.voice ? { voiceModel: patch.voice } : {}),
      ...(speakingVoice?.success
        ? {
            voices: {
              ...settings.current.voices,
              [speakingVoice.data.model]: speakingVoice.data.voice,
            },
          }
        : {}),
    });
    placement.place();
  };
  let pendingSleep: (() => void) | undefined;
  windowAction = action => {
    if (action === 'close') return workspace.hide();
    pendingSleep?.();
    // Asked to sleep mid-reply ("and you go to sleep"): say goodnight first, then sleep.
    if (agent.state.status !== 'running') return character.sleep();
    const runId = agent.state.runId;
    pendingSleep = sleepAfterReply(
      {
        writing: () => agent.state.status === 'running' && agent.state.runId === runId,
        speaking: () => voice.phase === 'processing' || voice.phase === 'speaking',
        // A new question (typed or spoken) keeps Edi awake.
        exchange: () =>
          `${voice.turn}:${agent.state.status === 'running' ? agent.state.runId : runId}`,
        asking: () => voice.holding,
      },
      () => character.sleep(),
    );
  };

  // A voice added or removed: Chatterbox reloads with the new set of recordings.
  personalVoices.onChange(() => {
    void personalVoices.list().then(list => {
      personalVoiceList = list;
      const chosen = settings.current.voices['chatterbox-turbo'];
      if (chosen !== 'calm' && chosen !== 'turbo' && !list.some(voice => voice.id === chosen))
        void settings.update({
          voices: { ...settings.current.voices, 'chatterbox-turbo': 'calm' },
        });
      chatterbox?.dispose();
      warmSelected();
    });
  });
  settings.onChange(value => {
    const shown = artifactWindow.window;
    broadcast(shown ? [workspace, pet, shown] : [workspace, pet], 'edi:settings', value);
    // Chatterbox is large; unload it when another model is chosen. Kokoro stays small and warm.
    if (value.voiceModel !== 'chatterbox-turbo') chatterbox?.dispose();
    warmSelected();
  });
  let runWasSpoken = false;
  let previousAgentStatus = agent.state.status;
  agent.onChange(state => {
    broadcast([workspace], 'edi:agent', state);
    if (state.status === 'running') pointer.dismiss(); // a new question clears the old answer
    // Their marks belong to the question they asked; once it is answered, the screen is theirs.
    if (state.status === 'running') annotations.keep();
    if (state.status !== 'running' && previousAgentStatus === 'running') annotations.clear();
    // One place to decide: the card's own review while it is open, the bubble otherwise.
    character.showApproval(cardOpen() ? null : (state.approval ?? tasks.currentApproval));
    const running = state.status === 'running' && !state.approval;
    // A new request gets a warm nod; progress follows unless the person is already watching
    // the conversation, where the steps are shown in full.
    if (state.status === 'running' && previousAgentStatus !== 'running') {
      character.acknowledge();
      runWasSpoken = agent.runningSpoken ?? false;
    }
    const watching = cardOpen() && currentView === 'conversations';
    character.setThinking(running, running && !watching ? progressLabel(state) : undefined);
    if (state.status === 'done' && previousAgentStatus !== 'done') character.showHappy();
    // The reply's mood shows as soon as its tag streams in and lingers a little after it ends;
    // a failure looks briefly sad.
    if (state.status === 'running') {
      mood.noteActivity();
      const felt = replyMood(state.text);
      if (felt && felt !== mood.current) mood.set(felt);
    } else if (previousAgentStatus === 'running') {
      if (state.status === 'error') mood.set('sad', 5000);
      // Voice turns report their own outcome; a typed question someone isn't watching must not
      // fail silently.
      if (state.status === 'error' && !runWasSpoken && !watching)
        character.showVoiceStatus({ notice: spokenFailure(state.error) });
      else mood.set(replyMood(state.text) ?? 'neutral', 9000);
    }
    previousAgentStatus = state.status;
    // A new review appears beside Edi first. The person can act there or reveal
    // the already-prepared full review in the content card.
  });

  placement.place();
  pet.webContents.on('render-process-gone', petDrag.cancel);
  const onDisplayChange = () => {
    petDrag.cancel();
    placement.recover();
  };
  screen.on('display-removed', onDisplayChange);
  screen.on('display-metrics-changed', onDisplayChange);
  pet.once('ready-to-show', () => pet.showInactive());
  workspace.on('focus', () => {
    permissions?.refresh();
    void fileAccess.refresh();
  });
  workspace.on('close', event => {
    if (quitting) return;
    event.preventDefault();
    workspace.hide();
  });
  workspace.on('blur', hideOnBlur);
  const approvalSurface = () =>
    character.showApproval(cardOpen() ? null : (agent.state.approval ?? tasks.currentApproval));
  tasks.onChange(list => {
    broadcast([workspace], 'edi:tasks', list);
    if (!agent.state.approval) approvalSurface();
  });
  // Queued tasks start once the windows exist; work that was running when Edi quit is marked.
  tasks.resume();
  scheduler.onChange(list => broadcast([workspace], 'edi:schedules', list));
  approvalRules.onChange(list => broadcast([workspace], 'edi:approval-rules', list));
  connectors.onChange(list => broadcast([workspace], 'edi:connectors', list));
  // A skill's apps show whether each is connected, so connector changes update Skills too.
  const skillSummaries = (): SkillsState => {
    const connected = new Set(
      connectors
        .list()
        .filter(connector => connector.status === 'connected')
        .map(connector => connector.catalogId),
    );
    return {
      skills: skills.list().map(skill => ({
        name: skill.name,
        title: skill.title,
        description: skill.description,
        author: skill.author || (skill.trust === 'fewerlabs' ? 'Fewerlabs' : ''),
        version: skill.version,
        trust: skill.trust,
        enabled: skill.enabled,
        license: skill.license,
        category: skill.category,
        icon: skill.icon,
        examples: skill.examples,
        instructions: skill.body,
        apps: skill.apps.flatMap(id => {
          const entry = connectorCatalog.find(item => item.id === id);
          return entry ? [{ id, name: entry.name, connected: connected.has(id) }] : [];
        }),
      })),
      issues: skills.problems().slice(0, 50),
    };
  };
  skills.onChange(() => broadcast([workspace], 'edi:skills', skillSummaries()));
  connectors.onChange(() => broadcast([workspace], 'edi:skills', skillSummaries()));
  connectors.start();
  scheduler.start();
  // A Mac waking from sleep checks for anything that came due meanwhile.
  powerMonitor.on('resume', () => scheduler.tick());
  workspace.on('show', approvalSurface);
  workspace.on('hide', approvalSurface);

  const resolveArtifact = async (ref: ArtifactRef): Promise<Artifact> => {
    const noteId =
      'noteId' in ref
        ? ref.noteId
        : (() => {
            const record = repositories.artifacts.get(ref.callId);
            if (record)
              return toArtifactContent(record.content as Parameters<typeof toArtifactContent>[0]);
            const [call] = repositories.toolCalls.shown(['notes.show'], { id: ref.callId });
            if (!call) throw new Error('That content is no longer available.');
            return String((call.input as { id?: unknown }).id ?? '');
          })();
    if (typeof noteId !== 'string') return noteId;
    const { note, markdown } = await readLibraryNote(repositories.notes, notesFolder, noteId);
    return { kind: 'note', title: note.title, markdown, noteId: note.id };
  };
  /** The file behind shown content: a Library note, or the workspace copy a tool call wrote. */
  const artifactPath = (ref: ArtifactRef) => {
    if ('noteId' in ref) {
      const note = repositories.notes.get(ref.noteId);
      if (!note) throw new Error('That note is no longer in Edi’s history.');
      return note.path;
    }
    const record = repositories.artifacts.get(ref.callId);
    if (record) {
      const path = resolve(workspaceFolder, record.path);
      if (relative(workspaceFolder, path).startsWith('..'))
        throw new Error('Outside the workspace.');
      return path;
    }
    const [call] = repositories.toolCalls.shown(['notes.show'], { id: ref.callId });
    if (!call) throw new Error('That content is no longer available.');
    return artifactPath({ noteId: String((call.input as { id?: unknown }).id ?? '') });
  };

  const exportsFolder = () => join(workspaceFolder, 'Exports');
  // Letter where it is the paper people print on; A4 everywhere else.
  const letterCountries = new Set(['US', 'CA', 'MX', 'PH', 'CL', 'CO', 'VE', 'GT', 'CR', 'PA']);
  const exporter = new Exporter({
    folder: exportsFolder,
    resolve: resolveArtifact,
    draw: (ref, format) => createExportWindow(ref, format),
    pageSize: () => (letterCountries.has(app.getLocaleCountryCode()) ? 'Letter' : 'A4'),
  });
  /** Export from the artifact window: straight to Exports, or through the save panel. */
  const exportFromWindow = async (ref: ArtifactRef, format: ExportFormat, choose: boolean) => {
    if (!choose) return { name: (await exporter.export(ref, format)).name };
    const content = await resolveArtifact(ref);
    const formats = [format, ...exportFormats[content.kind].filter(other => other !== format)];
    await mkdir(exportsFolder(), { recursive: true });
    const options = {
      defaultPath: join(exportsFolder(), exportFileName(content.title, format)),
      filters: formats.map(f => ({ name: exportFormatLabel[f], extensions: [f] })),
    };
    const owner = artifactWindow.window;
    const picked = owner
      ? await dialog.showSaveDialog(owner, options)
      : await dialog.showSaveDialog(options);
    if (picked.canceled || !picked.filePath) return null;
    // The format follows the extension the person kept in the save panel.
    const chosen = formats.find(f => picked.filePath!.toLowerCase().endsWith(`.${f}`));
    const path = chosen ? picked.filePath : `${picked.filePath}.${format}`;
    return { name: (await exporter.export(ref, chosen ?? format, path)).name };
  };

  /** Read a package the person chose or dropped. Only .edichar files, and never large ones. */
  const inspectCharacterFile = async (path: string) => {
    const fileName = basename(path);
    if (!fileName.toLowerCase().endsWith(packageExtension))
      throw new Error('Characters come as .edichar files.');
    const info = await stat(path);
    if (!info.isFile() || info.size > maxPackageBytes)
      throw new Error('That file is not a character package.');
    return characters.inspect(await readFile(path), fileName);
  };

  // Registered in the same tick as window creation, before any renderer can run.
  registerIpc({
    identify: sender => {
      if (!workspace.isDestroyed() && sender === workspace.webContents) return 'workspace';
      if (!pet.isDestroyed() && sender === pet.webContents) return 'pet';
      if (character.ownsMenu(sender)) return 'menu';
      if (character.ownsBubble(sender)) return 'bubble';
      if (artifactWindow.owns(sender)) return 'artifact';
      if (exporter.owns(sender)) return 'export';
      if (annotations.owns(sender)) return 'annotate';
      return undefined;
    },
    composioConfigured: () => composioCredentials.configured,
    routes: createCommandRoutes({
      workspace,
      pet,
      settings,
      agent,
      tasks,
      scheduler,
      approvalRules,
      connectors,
      skills,
      revealSkill: name => {
        const skill = skills.get(name);
        if (skill?.trust !== 'local')
          throw new Error('Only your own skills are in the Skills folder.');
        shell.showItemInFolder(join(skillsFolder(), name, 'SKILL.md'));
      },
      openSkillsFolder: async () => {
        await mkdir(skillsFolder(), { recursive: true });
        await shell.openPath(skillsFolder());
      },
      placement,
      petDrag,
      character,
      voice,
      permissions,
      openArtifact,
      artifactAction,
      revealExport: () => {
        if (exporter.lastPath) shell.showItemInFolder(exporter.lastPath);
      },
      exportReady: result => exporter.ready(result),
      annotationDrawn: box => annotations.drew(box),
      previewVoice,
      removePersonalVoice: id => personalVoices.remove(id),
      setVoiceKey: async (provider, apiKey) => {
        // A key is saved only after the provider accepts it.
        const listed = apiKey
          ? await listCloudVoices(provider, apiKey, AbortSignal.timeout(15_000))
          : [];
        await voiceKeys.set(provider, apiKey);
        if (apiKey) cloudVoiceLists[provider] = listed;
        else delete cloudVoiceLists[provider];
        // The first voice on the account is ready to use; switching to it stays the person's call.
        const first = listed[0];
        if (first && !settings.current.voices[provider])
          await settings.update({ voices: { ...settings.current.voices, [provider]: first.id } });
        if (!apiKey && settings.current.voiceModel === provider)
          await settings.update({ voiceModel: 'kokoro' });
        broadcast([workspace], 'edi:settings', settings.current);
      },
      // The command schema already allows only http(s) without credentials; parse again here.
      openLink: url => shell.openExternal(new URL(url).toString()),
      closeArtifact: () => artifactWindow.close(),
      deleteLibraryItem: async id => {
        await deleteWorkspaceItem(workspaceDeps, id);
        artifactWindow.closeIfShowing(id);
      },
      renameLibraryItem: async (id, title) => {
        await renameWorkspaceItem(workspaceDeps, id, title);
        artifactWindow.refreshIfShowing(id);
      },
      pinLibraryItem: (id, pinned) => {
        const at = pinned ? Date.now() : null;
        if (repositories.artifacts.get(id)) repositories.artifacts.setPinned(id, at);
        else repositories.notes.setPinned(id, at);
      },
      regenerateLibraryItem: async id => {
        const record = repositories.artifacts.get(id);
        const origin = record ? repositories.toolCalls.origin(id) : undefined;
        if (!record || !origin?.prompt.trim())
          throw new Error('Edi doesn’t know what this was made from, so it can’t make it again.');
        // Edi makes it again in the conversation it came from; replacing the item is reviewed there.
        const runId = await agent.ask(
          `Make “${record.title}” again from scratch: a fresh take on my original request, ` +
            `“${origin.prompt.slice(0, 1500)}”. Replace it in place with workspace_update ` +
            `(id ${id}, kind ${record.kind}) instead of showing something new, then tell me in ` +
            'one short sentence what’s different.',
          {
            ...(origin.conversationId ? { conversationId: origin.conversationId } : {}),
            note: `Making “${record.title}” again.`,
          },
        );
        if (runId) workspace.webContents.send('edi:navigate', 'conversations');
      },
      reportView: view => {
        currentView = view;
      },
      characters,
      revealLibraryItem: id => {
        const note = repositories.notes.get(id);
        shell.showItemInFolder(note ? note.path : artifactPath({ callId: id }));
      },
    }),
    settings: () => settings.current,
    agentState: () => agent.state,
    activity: () => repositories.activity(30),
    library: libraryItems,
    system: () => {
      const selected =
        voiceModels().find(item => item.id === settings.current.voiceModel) ?? voiceModels()[0]!;
      const speaking = selectedVoice();
      return {
        version: app.getVersion(),
        voice: {
          available: selected.available,
          name: `${spokenVoiceName(speaking)} · ${selected.name}`.slice(0, 120),
          models: voiceModels(),
        },
        pushToTalk: { status: hotkey.status, label: '⌥ Space' },
        workspaceFolder,
      };
    },
    models: () => modelCatalog.list(),
    conversations: query => agent.conversations(query),
    tasks: () => tasks.list(),
    schedules: () => scheduler.list(),
    approvalRules: () => approvalRules.list(),
    connectors: () => connectors.list(),
    skills: async () => {
      await skills.refresh();
      return skillSummaries();
    },
    usage: async days => ({
      ...repositories.usage.summary(days, Date.now()),
      account: await openRouterAccount.get(openRouter.apiKey),
    }),
    cloudVoices: provider => {
      if (!voiceKeys.has(provider)) return Promise.resolve([]);
      return loadCloudVoices(provider);
    },
    artifact: resolveArtifact,
    exportArtifact: exportFromWindow,
    permissions: () => permissions.snapshot(),
    fileAccess: () => fileAccess.snapshot(),
    fileAccessAction: action => fileAccess.act(action, workspace.isDestroyed() ? null : workspace),
    characters: () => characters.list(),
    pickCharacterPackage: async () => {
      const result = await dialog.showOpenDialog(workspace, {
        title: 'Add a character',
        buttonLabel: 'Check Character',
        properties: ['openFile'],
        filters: [{ name: 'Edi character', extensions: [packageExtension.slice(1)] }],
      });
      const path = result.filePaths[0];
      return result.canceled || !path ? null : inspectCharacterFile(path);
    },
    inspectCharacterFile,
    addPersonalVoice: async name => {
      const result = await dialog.showOpenDialog(workspace, {
        title: 'Add a voice',
        message: 'Choose at least 6 seconds of clear speech. It stays on this Mac.',
        buttonLabel: 'Use Recording',
        properties: ['openFile'],
        filters: [{ name: 'Audio', extensions: RECORDING_EXTENSIONS }],
      });
      const path = result.filePaths[0];
      if (result.canceled || !path) return null;
      try {
        const voice = await personalVoices.add(path, name);
        // A voice someone just added is the one they want to hear: select it, or replies keep
        // the previous voice (after removing a voice that is Calm, which sounds like someone else).
        personalVoiceList = await personalVoices.list();
        await settings.update({
          voiceModel: 'chatterbox-turbo',
          voices: { ...settings.current.voices, 'chatterbox-turbo': voice.id },
        });
        return { ok: true as const, voice };
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        return {
          ok: false as const,
          error:
            message.length > 0 && message.length <= 200
              ? message
              : 'That recording couldn’t be used.',
        };
      }
    },
  });

  // The app menu is still called Edi; its items use the companion's name and follow a rename.
  const applicationMenu = () =>
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { label: 'Edi', submenu: character.menuItems() },
        { role: 'editMenu' },
        { role: 'viewMenu' },
        { role: 'windowMenu' },
      ]),
    );
  applicationMenu();
  let menuName = companion();
  settings.onChange(() => {
    if (companion() === menuName) return;
    menuName = companion();
    applicationMenu();
  });
  characters.onChange(async list => {
    broadcast(
      [workspace, pet, ...(artifactWindow.window ? [artifactWindow.window] : [])],
      'edi:characters',
      list,
    );
    // A removed character hands the desktop back to Edi.
    if (!characters.has(settings.current.skin)) await settings.update({ skin: defaultCharacterId });
  });
  // Hands-free listening starts only from Edi → Listen; reopening Edi shows it instead.
  const reopen = () => {
    pet.showInactive();
    character.showContent();
  };
  app.on('activate', reopen);
  app.on('second-instance', reopen);
  app.on('before-quit', () => {
    quitting = true;
    hotkey.dispose();
    character.dispose();
    petDrag.cancel();
    agent.stop();
  });
  app.on('will-quit', () => {
    scheduler.dispose();
    void connectors.dispose();
    tasks.dispose();
    chatterbox?.dispose();
    kokoro?.dispose();
    whisper?.dispose();
    database.close();
  });
}

if (process.platform === 'darwin') app.setName('Edi');
registerArtifactScheme();
if (process.env.EDI_VOICE !== 'off' && !app.requestSingleInstanceLock()) {
  void app.whenReady().then(() => {
    recordMicrophoneStatus('ready');
    app.quit();
  });
} else {
  void app.whenReady().then(() => {
    recordMicrophoneStatus('ready');
    return start();
  });
}
app.on('will-quit', () => globalShortcut.unregisterAll());
