import { app, globalShortcut, Menu, screen, session, systemPreferences } from 'electron';
import { join } from 'node:path';
import { notesCapabilities } from '@edi/capabilities';
import { createRepositories, openDatabase } from '@edi/storage';
import { AgentService } from './agent/agent-service';
import { captureScreens } from './capture/screens';
import { speakPocket } from './voice/pocket-process';
import { resolveVoiceRuntime } from './voice/runtime';
import { transcribePcm } from './voice/transcription-process';
import { VoiceController } from './voice/voice-controller';
import { OpenRouterCredentials } from './agent/credentials';
import { CharacterActions } from './character/character-actions';
import { createCommandRoutes } from './ipc/commands';
import { registerIpc } from './ipc/router';
import { PetDrag } from './character/pet-drag';
import { SettingsStore } from './settings/settings-store';
import { WindowPlacement } from './windows/placement';
import {
  broadcast,
  createCharacterMenuWindow,
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
  const agent = new AgentService({
    credentials: new OpenRouterCredentials(),
    repositories,
    capabilities: notesCapabilities({
      directory: () => join(app.getPath('documents'), 'Edi Notes'),
      store: repositories.notes,
    }),
    captureScreens,
  });
  await Promise.all([settings.load(), agent.load()]);

  const workspace = createWorkspaceWindow();
  const pet = createPetWindow(settings.current.petPosition);
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
  const voice = new VoiceController({
    runtime: voiceRuntime,
    send: event => broadcast([pet], 'edi:voice', event),
    status: status => character.showVoiceStatus(status),
    microphoneAccess: async () =>
      systemPreferences.getMediaAccessStatus('microphone') === 'granted' ||
      systemPreferences.askForMediaAccess('microphone'),
    captureScreens,
    ask: (prompt, options) => agent.ask(prompt, options),
    whenFinished: (runId, signal) => agent.whenFinished(runId, signal),
    stopAgent: () => agent.stop(),
    transcribe: transcribePcm,
    speak: speakPocket,
  });

  // Nothing is granted except the microphone, to the pet window, audio only, and
  // only while a voice turn is opening or listening.
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const audioOnly =
      permission === 'media' &&
      'mediaTypes' in details &&
      (details.mediaTypes ?? []).length > 0 &&
      (details.mediaTypes ?? []).every(type => type === 'audio');
    callback(audioOnly && contents === pet.webContents && voice.wantsMicrophone);
  });

  const character = new CharacterActions({
    pet,
    card: workspace,
    skin: () => settings.current.skin,
    voiceReady: () => voice.available,
    showContent: () => placement.show(),
    stopWork: () => {
      petDrag.cancel();
      voice.stop();
      agent.stop();
    },
    createBubble: createStatusBubbleWindow,
    createMenu: createCharacterMenuWindow,
    quit: () => app.quit(),
  });

  settings.onChange(value => broadcast([workspace, pet], 'edi:settings', value));
  let shownApproval: string | null = null;
  agent.onChange(state => {
    broadcast([workspace], 'edi:agent', state);
    character.setThinking(state.status === 'running' && !state.text && !state.approval);
    // A new review surfaces the card even if it was hidden, without stealing focus.
    const approval = state.approval?.callId ?? null;
    if (approval && approval !== shownApproval) placement.reveal();
    shownApproval = approval;
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
  workspace.on('close', event => {
    if (quitting) return;
    event.preventDefault();
    workspace.hide();
  });
  workspace.on('blur', () => {
    if (!settings.current.pinned) workspace.hide();
  });

  // Registered in the same tick as window creation, before any renderer can run.
  registerIpc({
    identify: sender => {
      if (!workspace.isDestroyed() && sender === workspace.webContents) return 'workspace';
      if (!pet.isDestroyed() && sender === pet.webContents) return 'pet';
      if (character.ownsMenu(sender)) return 'menu';
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
    }),
    settings: () => settings.current,
    agentState: () => agent.state,
    activity: () => repositories.activity(30),
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
    character.dispose();
    petDrag.cancel();
    agent.stop();
  });
  app.on('will-quit', () => database.close());
}

if (!app.requestSingleInstanceLock()) app.quit();
else void app.whenReady().then(start);
app.on('will-quit', () => globalShortcut.unregisterAll());
