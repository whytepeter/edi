import { app, globalShortcut, Menu, screen, systemPreferences } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
import { notesCapabilities } from '@edi/capabilities';
import { createRepositories, openDatabase } from '@edi/storage';
import { AgentService } from './agent/agent-service';
import { captureScreensForPrompt } from './capture/screens';
import { shouldHideCardOnBlur } from './permissions';
import type { PermissionManager } from './permission-manager';
import { PocketVoice } from './voice/pocket-process';
import { resolveVoiceRuntime } from './voice/runtime';
import { transcribePcm } from './voice/transcription-process';
import { VoiceController } from './voice/voice-controller';
import { OpenRouterCredentials } from './agent/credentials';
import { HoldHotkey, optionSpace, resolveHotkeyHelper } from './input/hold-hotkey';
import { PointerOverlay } from './presentation/pointer';
import { CharacterActions } from './character/character-actions';
import { createCommandRoutes } from './ipc/commands';
import { registerIpc } from './ipc/router';
import { PetDrag } from './character/pet-drag';
import { SettingsStore } from './settings/settings-store';
import { WindowPlacement } from './windows/placement';
import { createMacMediaPermissions } from './platform/macos-media-permissions';
import {
  broadcast,
  createCharacterMenuWindow,
  createPointerWindow,
  createPetWindow,
  createStatusBubbleWindow,
  createWorkspaceWindow,
} from './windows/factory';

let quitting = false;

/** Composition root: construct services, wire them together, own app lifecycle. */
async function start() {
  // One SQLite writer, owned here. Nothing in flight at the last quit is replayed.
  const database = openDatabase(join(app.getPath('userData'), 'edi.sqlite'));
  const repositories = createRepositories(database);
  repositories.recoverInterrupted(Date.now());

  const settings = new SettingsStore();
  const permissionPort: { current?: PermissionManager } = {};
  const agent = new AgentService({
    credentials: new OpenRouterCredentials(),
    repositories,
    capabilities: notesCapabilities({
      directory: () => join(app.getPath('documents'), 'Edi Notes'),
      store: repositories.notes,
    }),
    captureScreens: captureScreensForPrompt,
    screenPermissionRequired: () => permissionPort.current?.require('screen-recording'),
    point: target => pointer.show(target),
  });
  await Promise.all([settings.load(), agent.load()]);

  const workspace = createWorkspaceWindow();
  const pet = createPetWindow(settings.current.petPosition);
  const pointer = new PointerOverlay({
    pet,
    skin: () => settings.current.skin,
    create: createPointerWindow,
  });
  const placement = new WindowPlacement(
    pet,
    workspace,
    () => settings.current.skin,
    () => settings.current.pinned,
  );
  const petDrag = new PetDrag(
    pet,
    () => placement.place(),
    petPosition => settings.update({ petPosition }),
  );
  // Local voice. EDI_VOICE=off disables it (developer machines, automated desktop tests
  // that must never open a real microphone).
  const voiceRuntime =
    process.env.EDI_VOICE === 'off' ? null : resolveVoiceRuntime(app.getAppPath(), app.isPackaged);
  const pocket = voiceRuntime ? new PocketVoice(voiceRuntime.pocket) : null;
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
    whenFinished: (runId, signal) => agent.whenFinished(runId, signal),
    stopAgent: () => agent.stop(),
    transcribe: transcribePcm,
    speak: (text, signal, consume) =>
      pocket ? pocket.speak(text, signal, consume) : Promise.reject(new Error('No voice')),
    warmSpeech: () => pocket?.warm(),
  });

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
    stopWork: () => {
      pointer.dismiss();
      petDrag.cancel();
      voice.stop();
      agent.stop();
    },
    createBubble: createStatusBubbleWindow,
    createMenu: createCharacterMenuWindow,
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
  hotkey.start();

  settings.onChange(value => broadcast([workspace, pet], 'edi:settings', value));
  agent.onChange(state => {
    broadcast([workspace], 'edi:agent', state);
    if (state.status === 'running') pointer.dismiss(); // a new question clears the old answer
    character.showApproval(state.approval);
    character.setThinking(state.status === 'running' && !state.text && !state.approval);
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
  workspace.on('blur', () => {
    if (shouldHideCardOnBlur(settings.current.pinned, mediaPermissions.holdsCardOpen())) {
      workspace.hide();
    }
  });

  // Registered in the same tick as window creation, before any renderer can run.
  registerIpc({
    identify: sender => {
      if (!workspace.isDestroyed() && sender === workspace.webContents) return 'workspace';
      if (!pet.isDestroyed() && sender === pet.webContents) return 'pet';
      if (character.ownsMenu(sender)) return 'menu';
      if (character.ownsBubble(sender)) return 'bubble';
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
    }),
    settings: () => settings.current,
    agentState: () => agent.state,
    activity: () => repositories.activity(30),
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
  // Temporary conversation shortcut; ⌥ Space push-to-talk needs a native key-up adapter.
  globalShortcut.register('CommandOrControl+Shift+E', () => character.requestListening());
  app.on('activate', () => character.requestListening());
  app.on('second-instance', () => character.requestListening());
  app.on('before-quit', () => {
    quitting = true;
    hotkey.dispose();
    character.dispose();
    petDrag.cancel();
    agent.stop();
  });
  app.on('will-quit', () => {
    pocket?.dispose();
    database.close();
  });
}

if (process.platform === 'darwin') app.setName('Edi');
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
