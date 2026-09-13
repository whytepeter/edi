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
  workspaceCapabilities,
  type EdiPreferences,
  type EdiSetupSnapshot,
  type WorkspaceDependencies,
} from '@edi/capabilities';
import {
  artifactExport,
  artifactPreview,
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
import { ChatterboxVoice } from './voice/chatterbox-process';
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
  const voiceModels = (): SystemInfo['voice']['models'] => [
    {
      id: 'pocket',
      name: 'Jane · Pocket',
      available: Boolean(voiceRuntime),
      expressions: false,
      detail: 'Fast local voice',
    },
    {
      id: 'chatterbox-turbo',
      name: 'Chatterbox Turbo',
      available: Boolean(voiceRuntime?.chatterbox),
      expressions: true,
      detail: chatterboxDetail(),
    },
  ];
  // Chatterbox is created after the settings snapshot helpers; read it lazily.
  let chatterboxVoice: ChatterboxVoice | null = null;
  const chatterboxDetail = () => {
    const base = 'Expressive local voice with laughs, sighs and more.';
    if (!chatterboxVoice) return base;
    if (chatterboxVoice.status === 'loading')
      return 'Warming up on this Mac. Jane answers until Chatterbox is ready.';
    const rtf = chatterboxVoice.lastRealTimeFactor;
    const first = chatterboxVoice.lastFirstAudioMs;
    if (rtf !== null && first !== null)
      return `${base} Last reply started in ${(first / 1000).toFixed(1)}s at ${rtf.toFixed(1)}× real time.`;
    return chatterboxVoice.status === 'ready' ? `${base} Ready.` : base;
  };
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
    const selectedVoice =
      voiceModels().find(item => item.id === settings.current.voiceModel) ?? voiceModels()[0]!;
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
        'Changing the keyboard shortcut',
      ],
      current: {
        size: settings.current.petScale,
        character: { id: character.id, name: character.name },
        voice: {
          id: selectedVoice.id,
          name: selectedVoice.name,
          available: selectedVoice.available,
          expressions: selectedVoice.expressions,
          detail: selectedVoice.detail,
          status:
            selectedVoice.id === 'chatterbox-turbo'
              ? (chatterboxVoice?.status ?? 'off')
              : selectedVoice.available
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
  const chatterbox = voiceRuntime?.chatterbox
    ? new ChatterboxVoice(voiceRuntime.chatterbox, { idleMs: 60 * 60_000 })
    : null;
  chatterboxVoice = chatterbox;
  // Chatterbox speaks only once loaded; until then Jane answers so a reply is never minutes late.
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
      if (settings.current.voiceModel === 'chatterbox-turbo') chatterbox?.warm();
      if (expressiveReady() && chatterbox) {
        try {
          await chatterbox.speak(text, signal, consume);
          return;
        } catch (error) {
          if (signal.aborted || !pocket) throw error;
          // If the expressive engine fails, preserve the talking turn with Jane.
          await pocket.speak(speakable(text, false), signal, consume);
          return;
        }
      }
      if (!pocket) throw new Error('No voice');
      await pocket.speak(speakable(text, false), signal, consume);
    },
    warmSpeech: () => {
      if (settings.current.voiceModel === 'chatterbox-turbo' && chatterbox) chatterbox.warm();
      else pocket?.warm();
    },
    speakReplies: () => settings.current.speakReplies,
    expressiveVoice: expressiveReady,
  });
  // Chatterbox takes tens of seconds to load. Start now, not after the reply is on screen.
  if (settings.current.voiceModel === 'chatterbox-turbo') chatterbox?.warm();

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
    if (patch.voice === 'chatterbox-turbo' && !voiceRuntime?.chatterbox)
      throw new Error('Chatterbox Turbo is not installed on this Mac.');
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
    if (value.voiceModel === 'chatterbox-turbo') chatterbox?.warm();
    else chatterbox?.dispose();
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
      return {
        version: app.getVersion(),
        voice: { available: selected.available, name: selected.name, models: voiceModels() },
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
