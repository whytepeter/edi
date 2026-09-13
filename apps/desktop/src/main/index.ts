import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  Menu,
  screen,
  shell,
  systemPreferences,
} from 'electron';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

if (process.env.EDI_CWD) process.chdir(process.env.EDI_CWD);

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
  deleteWorkspaceItem,
  ediSetupCapabilities,
  notesCapabilities,
  readLibraryNote,
  toArtifactContent,
  webCapabilities,
  workspaceCapabilities,
  type EdiPreferences,
  type EdiSetupSnapshot,
  type WorkspaceDependencies,
} from '@edi/capabilities';
import {
  artifactExport,
  artifactPreview,
  voiceCatalog,
  voiceName,
  voiceSelectionSchema,
  type VoiceSelection,
  skins,
  type Artifact,
  type ArtifactRef,
  type ArtifactSummary,
  type LibraryItem,
  type SystemInfo,
  type WorkspaceView,
} from '@edi/contracts';
import { createRepositories, openDatabase } from '@edi/storage';
import { AgentService } from './agent/agent-service';
import { captureScreensForPrompt } from './capture/screens';
import { shouldHideCardOnBlur } from './permissions';
import type { PermissionManager } from './permission-manager';
import { PocketVoice } from './voice/pocket-process';
import { MlxVoice } from './voice/mlx-process';
import { resolveVoiceRuntime } from './voice/runtime';
import { transcribePcm } from './voice/transcription-process';
import { speakable, VoiceController } from './voice/voice-controller';
import { OpenRouterCredentials } from './agent/credentials';
import { ModelCatalog } from './agent/model-catalog';
import { HoldHotkey, optionSpace, resolveHotkeyHelper } from './input/hold-hotkey';
import { PointerOverlay } from './presentation/pointer';
import { CharacterActions } from './character/character-actions';
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
  createPointerWindow,
  createPetWindow,
  createStatusBubbleWindow,
  createWorkspaceWindow,
  resizePetWindow,
} from './windows/factory';

/** Display tools whose successful calls become artifacts in the conversation. */
const DISPLAY_CAPABILITIES = ['workspace.show', 'notes.show'] as const;

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
  // One user-visible workspace. Structured generated content and human notes remain distinct.
  const workspaceFolder = join(app.getPath('documents'), 'Edi');
  const notesFolder = () => join(workspaceFolder, 'Notes');
  moveLegacyNotes(join(app.getPath('documents'), 'Edi Notes'), notesFolder(), repositories.notes);
  const permissionPort: { current?: PermissionManager } = {};
  // Local speech/transcription assets are resolved before the agent so its setup skill
  // reports the same availability used by the voice controller.
  const voiceRuntime =
    process.env.EDI_VOICE === 'off' ? null : resolveVoiceRuntime(app.getAppPath(), app.isPackaged);
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
      id: 'pocket',
      name: 'Pocket',
      available: Boolean(voiceRuntime),
      expressions: false,
      detail: 'Kyutai’s streaming voice.',
    },
    {
      id: 'chatterbox-turbo',
      name: 'Chatterbox Turbo',
      available: Boolean(voiceRuntime?.mlx?.chatterbox),
      expressions: true,
      detail: engineDetail(chatterboxVoice, 'Expressive, with laughs and sighs.'),
    },
  ];
  const selectedVoice = (): VoiceSelection =>
    voiceSelectionSchema.parse({
      model: settings.current.voiceModel,
      voice: settings.current.voices[settings.current.voiceModel],
    });
  let openSetup = (_page: WorkspaceView) => {};
  // Filled in once windows exist; capabilities call these lazily.
  let showArtifact = (_artifact: ArtifactSummary) => {};
  let applyPreferences = async (_patch: EdiPreferences) => {};
  let windowAction = (_action: 'close' | 'sleep') => {};
  let cardOpen = () => false;
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
  };
  const libraryItems = (): LibraryItem[] => {
    const notes: LibraryItem[] = repositories.notes
      .list(500)
      .map(({ id, title, bytes, createdAt }) => ({
        id,
        kind: 'note',
        title,
        bytes,
        createdAt,
      }));
    const artifacts: LibraryItem[] = repositories.artifacts
      .list(500)
      .map(({ id, kind, title, bytes, updatedAt }) => ({
        id,
        kind,
        title,
        bytes,
        createdAt: updatedAt,
      }));
    return [...notes, ...artifacts].sort((a, b) => b.createdAt - a.createdAt).slice(0, 500);
  };
  const setupSnapshot = (): EdiSetupSnapshot => {
    const character = skins.find(item => item.id === settings.current.skin) ?? skins[0];
    const selectedModel =
      voiceModels().find(item => item.id === settings.current.voiceModel) ?? voiceModels()[0]!;
    const speaking = selectedVoice();
    const items = libraryItems();
    const notes = items.filter(item => item.kind === 'note');
    return {
      identity: { name: 'Edi', version: app.getVersion() },
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
        { name: 'Open any page in Edi, including Settings', asksFirst: false },
        {
          name: 'Change its character, size, pin, voice and whether replies are spoken',
          asksFirst: false,
        },
        { name: 'Close its card or go to sleep', asksFirst: false },
        { name: 'Point at and draw on the screen', asksFirst: false },
      ],
      notYetAvailable: [
        'Installing skills',
        'Connecting apps or MCP servers',
        'Background tasks, reminders and watches',
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
          speakingVoice: { id: speaking.voice, name: voiceName(speaking.model, speaking.voice) },
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
      skills: [],
      connectors: [],
      permissions: (permissionPort.current?.snapshot().permissions ?? []).map(({ id, status }) => ({
        id,
        status,
      })),
      availableCharacters: skins.map(({ id, name }) => ({ id, name })),
      availableVoices: voiceModels().map(({ id, name, available, expressions, detail }) => ({
        id,
        name,
        available,
        expressions,
        detail,
        voices: voiceCatalog[id].map(voice => ({ ...voice })),
      })),
    };
  };
  // EDI_MODEL_CATALOG=off keeps automated desktop tests off the network.
  const modelCatalog =
    process.env.EDI_MODEL_CATALOG === 'off'
      ? { list: () => Promise.reject(new Error('Model catalog disabled.')) }
      : new ModelCatalog();
  agent = new AgentService({
    credentials: new OpenRouterCredentials(),
    repositories,
    capabilities: [
      ...notesCapabilities({
        directory: notesFolder,
        store: repositories.notes,
        shown: artifact => showArtifact(artifact),
      }),
      ...workspaceCapabilities(workspaceDeps),
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
      ...ediSetupCapabilities({
        snapshot: setupSnapshot,
        open: page => openSetup(page),
        change: patch => applyPreferences(patch),
        window: action => windowAction(action),
      }),
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
  });
  await agent.load();

  const workspace = createWorkspaceWindow();
  const pet = createPetWindow(settings.current.petPosition, settings.current.petScale);
  cardOpen = () => !workspace.isDestroyed() && workspace.isVisible();
  const pointer = new PointerOverlay({
    pet,
    skin: () => settings.current.skin,
    create: createPointerWindow,
  });
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
    () => settings.current.skin,
    () => artifactWindow.follow(),
  );
  const petDrag = new PetDrag(
    pet,
    () => placement.place(),
    petPosition => settings.update({ petPosition }),
  );
  const pocket = voiceRuntime ? new PocketVoice(voiceRuntime.pocket) : null;
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
        { id: 'chatterbox-turbo', model: mlx.chatterbox, label: 'Chatterbox Turbo' },
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
    if (selection.model === 'pocket' && pocket)
      return pocket.speak(speakable(text, false), signal, consume);
    return Promise.reject(new Error('That voice is not installed on this Mac.'));
  };
  const standIn = (): VoiceSelection | null =>
    kokoro
      ? { model: 'kokoro', voice: settings.current.voices.kokoro }
      : pocket
        ? { model: 'pocket', voice: 'jane' }
        : null;
  const warmSelected = () => {
    const model = settings.current.voiceModel;
    if (model === 'chatterbox-turbo') {
      chatterbox?.warm();
      kokoro?.warm();
    } else if (model === 'kokoro') kokoro?.warm();
    else pocket?.warm();
  };
  const expressiveReady = () =>
    settings.current.voiceModel === 'chatterbox-turbo' && chatterbox?.status === 'ready';
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
    transcribe: transcribePcm,
    speak: async (text, signal, consume) => {
      warmSelected();
      const selected = selectedVoice();
      // Chatterbox answers once loaded; until then Kokoro (or Jane) keeps the reply prompt.
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
        // A failed engine hands the reply to Jane, but never repeats audio already heard.
        if (signal.aborted || delivered || chosen.model === 'pocket' || !pocket) throw error;
        await speakWith({ model: 'pocket', voice: 'jane' }, text, signal, consume);
      }
    },
    warmSpeech: warmSelected,
    speakReplies: () => settings.current.speakReplies,
    expressiveVoice: expressiveReady,
  });
  // Engines take seconds to load. Start now, not after the reply is on screen.
  warmSelected();
  const previewVoice = async (selection: VoiceSelection) => {
    const name = voiceName(selection.model, selection.voice);
    const sample =
      selection.model === 'chatterbox-turbo'
        ? `Hi, I'm Edi. [chuckle] This is how I sound with ${name}.`
        : `Hi, I'm Edi. This is how I sound as ${name}.`;
    const played = await voice.preview((signal, consume) =>
      speakWith(selection, sample, signal, consume),
    );
    if (!played) throw new Error('Edi is using its voice right now.');
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
  const character = new CharacterActions({
    pet,
    card: workspace,
    skin: () => settings.current.skin,
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
    quit: () => app.quit(),
  });

  // Global hold-to-talk: the same turn as holding the character, and it wakes Edi
  // from Sleep. Only while voice works, so ⌥ Space is left alone otherwise.
  const hotkey = new HoldHotkey(
    voice.available
      ? resolveHotkeyHelper(app.getAppPath(), app.isPackaged, process.resourcesPath)
      : null,
    optionSpace,
    {
      down: () => {
        pet.showInactive();
        character.requestListening('push-to-talk');
      },
      up: () => {
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
  const artifactAction = async (action: 'copy' | 'download' | 'reveal', ref: ArtifactRef) => {
    if (action === 'reveal') return shell.showItemInFolder(artifactPath(ref));
    const content = await resolveArtifact(ref);
    const { copy, extension, file } = artifactExport(content);
    if (action === 'copy') return clipboard.writeText(copy);
    const name = content.title.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Edi';
    const options = {
      defaultPath: join(app.getPath('downloads'), `${name}.${extension}`),
      filters: [
        extension === 'csv'
          ? { name: 'CSV', extensions: ['csv'] }
          : extension === 'html'
            ? { name: 'Web page', extensions: ['html'] }
            : { name: 'Markdown', extensions: ['md'] },
      ],
    };
    const owner = artifactWindow.window;
    const result = owner
      ? await dialog.showSaveDialog(owner, options)
      : await dialog.showSaveDialog(options);
    if (!result.canceled && result.filePath) await writeFile(result.filePath, file);
  };
  showArtifact = artifact => {
    agent.addArtifact(artifact);
    if (agent.runningSpoken && !cardOpen()) character.showArtifact(artifact);
    else openArtifact({ callId: artifact.id });
  };
  applyPreferences = async patch => {
    if (patch.voice && !voiceModels().find(model => model.id === patch.voice)?.available)
      throw new Error('That voice model is not installed on this Mac.');
    const model = patch.voice ?? settings.current.voiceModel;
    const speakingVoice = patch.speakingVoice
      ? voiceSelectionSchema.safeParse({ model, voice: patch.speakingVoice })
      : null;
    if (speakingVoice && !speakingVoice.success)
      throw new Error(`That voice is not one of ${model}'s voices. Check availableVoices.`);
    if (patch.size !== undefined) {
      const skin = patch.character ?? settings.current.skin;
      const bounds = resizePetWindow(pet, patch.size, skin);
      await settings.update({ petScale: patch.size, petPosition: { x: bounds.x, y: bounds.y } });
    }
    await settings.update({
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
  windowAction = action => {
    if (action === 'close') workspace.hide();
    else character.sleep();
  };

  settings.onChange(value => {
    const shown = artifactWindow.window;
    broadcast(shown ? [workspace, pet, shown] : [workspace, pet], 'edi:settings', value);
    // Chatterbox is large; unload it when another model is chosen. Kokoro stays small and warm.
    if (value.voiceModel !== 'chatterbox-turbo') chatterbox?.dispose();
    warmSelected();
  });
  let previousAgentStatus = agent.state.status;
  agent.onChange(state => {
    broadcast([workspace], 'edi:agent', state);
    if (state.status === 'running') pointer.dismiss(); // a new question clears the old answer
    character.showApproval(state.approval);
    character.setThinking(state.status === 'running' && !state.approval);
    if (state.status === 'done' && previousAgentStatus !== 'done') character.showHappy();
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
  workspace.on('focus', () => permissions?.refresh());
  workspace.on('close', event => {
    if (quitting) return;
    event.preventDefault();
    workspace.hide();
  });
  workspace.on('blur', hideOnBlur);

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

  // Registered in the same tick as window creation, before any renderer can run.
  registerIpc({
    identify: sender => {
      if (!workspace.isDestroyed() && sender === workspace.webContents) return 'workspace';
      if (!pet.isDestroyed() && sender === pet.webContents) return 'pet';
      if (character.ownsMenu(sender)) return 'menu';
      if (character.ownsBubble(sender)) return 'bubble';
      if (artifactWindow.owns(sender)) return 'artifact';
      return undefined;
    },
    routes: createCommandRoutes({
      workspace,
      pet,
      settings,
      agent,
      placement,
      petDrag,
      character,
      voice,
      permissions,
      openArtifact,
      artifactAction,
      previewVoice,
      // The command schema already allows only http(s) without credentials; parse again here.
      openLink: url => shell.openExternal(new URL(url).toString()),
      closeArtifact: () => artifactWindow.close(),
      deleteLibraryItem: async id => {
        await deleteWorkspaceItem(workspaceDeps, id);
        artifactWindow.closeIfShowing(id);
      },
      reportView: view => {
        currentView = view;
      },
      revealLibraryItem: id => {
        const note = repositories.notes.get(id);
        if (!note) throw new Error('That note is no longer in Edi’s history.');
        shell.showItemInFolder(note.path);
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
          name: `${voiceName(speaking.model, speaking.voice)} · ${selected.name}`,
          models: voiceModels(),
        },
        pushToTalk: { status: hotkey.status, label: '⌥ Space' },
        notesFolder: notesFolder(),
      };
    },
    models: () => modelCatalog.list(),
    artifact: resolveArtifact,
    permissions: () => permissions.snapshot(),
  });

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: 'Edi', submenu: character.menuItems() },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]),
  );
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
    pocket?.dispose();
    chatterbox?.dispose();
    kokoro?.dispose();
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
