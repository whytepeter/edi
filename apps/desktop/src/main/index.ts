import {
  app,
  globalShortcut,
  Menu,
  screen,
  session,
  systemPreferences,
  type WebContents,
} from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

if (process.env.EDI_CWD) process.chdir(process.env.EDI_CWD);

function recordMicrophoneStatus(phase: string) {
  const out = process.env.EDI_MIC_OUT;
  if (!out) return;
  try {
    writeFileSync(
      out,
      `${phase}=${systemPreferences.getMediaAccessStatus('microphone')}\n`,
      { flag: 'a' },
    );
  } catch {
    // Probe path only; ignore a failed write.
  }
}
recordMicrophoneStatus('boot');
import { presentationText } from '@edi/contracts';
import { notesCapabilities } from '@edi/capabilities';
import { createRepositories, openDatabase } from '@edi/storage';
import { AgentService } from './agent/agent-service';
import { captureScreens } from './capture/screens';
import { ScreenRecording, shouldHideCardOnBlur } from './permissions';
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
  const agent = new AgentService({
    credentials: new OpenRouterCredentials(),
    repositories,
    capabilities: notesCapabilities({
      directory: () => join(app.getPath('documents'), 'Edi Notes'),
      store: repositories.notes,
    }),
    captureScreens,
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
    microphoneAccess: () => requestMicrophoneAccess(),
    captureScreens,
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

  // Hiding the card on blur dismisses macOS permission prompts. Hold it up
  // for the ask, including the Chromium getUserMedia fallback.
  let holdCard = false;
  const screenRecording = new ScreenRecording({
    read: () => ({
      prompted: settings.current.screenRecordingPrompted,
      confirmed: settings.current.screenRecordingConfirmed,
    }),
    write: next =>
      settings.update({
        screenRecordingPrompted: next.prompted,
        screenRecordingConfirmed: next.confirmed,
      }),
  });
  const requestScreenRecording = async () => {
    const cardWasOpen = !workspace.isDestroyed() && workspace.isVisible();
    holdCard = true;
    try {
      // The conversation button is on the card. Focusing the pet blurs it, and
      // hide-on-blur then closes Talk to Edi. Keep the card if it is already up.
      if (cardWasOpen && !workspace.isDestroyed()) {
        workspace.show();
        workspace.focus();
      } else if (!pet.isDestroyed()) pet.show();
      const { access } = await screenRecording.request();
      agent.rememberScreenAccess(access);
      if (
        access === 'granted' &&
        systemPreferences.getMediaAccessStatus('microphone') !== 'granted' &&
        !workspace.isDestroyed()
      ) {
        workspace.webContents.send('edi:microphone-permission', 'blocked');
      }
      return access;
    } finally {
      // The system sheet can appear after CGRequest returns. Keep the card
      // up so hide-on-blur does not dismiss it. Do not block the click.
      setTimeout(() => {
        holdCard = false;
        if (cardWasOpen && !workspace.isDestroyed()) workspace.show();
      }, 8_000);
    }
  };
  let microphoneProbe = false;
  const requestMicrophoneAccess = async () => {
    if (systemPreferences.getMediaAccessStatus('microphone') === 'granted') return true;
    holdCard = true;
    try {
      if (!workspace.isDestroyed()) {
        workspace.show();
        workspace.focus();
      }
      try {
        if (await systemPreferences.askForMediaAccess('microphone')) return true;
      } catch {
        // Chromium's getUserMedia can still raise the prompt.
      }
      if (pet.isDestroyed()) return false;
      microphoneProbe = true;
      return (
        (await pet.webContents.executeJavaScript(
          'navigator.mediaDevices.getUserMedia({audio:true,video:false}).then(s=>{s.getTracks().forEach(t=>t.stop());true}).catch(()=>false)',
        )) === true
      );
    } catch {
      return false;
    } finally {
      microphoneProbe = false;
      holdCard = false;
      if (
        systemPreferences.getMediaAccessStatus('microphone') !== 'granted' &&
        !workspace.isDestroyed()
      ) {
        workspace.webContents.send('edi:microphone-permission', 'blocked');
        placement.reveal();
      }
    }
  };

  // Nothing is granted except the microphone, to the pet window, audio only, and
  // only while a voice turn is opening or listening.
  const audioOnly = (details: object) => {
    const types = 'mediaTypes' in details ? details.mediaTypes : undefined;
    if (Array.isArray(types)) return types.length > 0 && types.every(type => type === 'audio');
    const type = 'mediaType' in details ? details.mediaType : undefined;
    return type === undefined || type === 'audio';
  };
  const allowMicrophone = (contents: WebContents | null, permission: string, details: object) => {
    if (permission !== 'microphone' && permission !== 'audioCapture' && permission !== 'media')
      return false;
    if (permission === 'media' && !audioOnly(details)) return false;
    // Chromium pre-checks with no window. Denying those suppresses the prompt.
    if (!contents) return true;
    if (contents === workspace.webContents) return true;
    return contents === pet.webContents && (voice.wantsMicrophone || microphoneProbe);
  };
  session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) =>
    allowMicrophone(contents, permission, details),
  );
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(allowMicrophone(contents, permission, details));
  });
  const character = new CharacterActions({
    pet,
    card: workspace,
    skin: () => settings.current.skin,
    voiceReady: () => voice.available,
    holdHint: () =>
      hotkey.status === 'ready'
        ? `Hold ${optionSpace.label}, or hold me, to talk`
        : 'Hold me down and talk to me',
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
        if (!voice.start('push-to-talk')) character.requestListening('push-to-talk');
      },
      up: () => {
        if (voice.phase !== 'idle') voice.release();
        else character.releaseListening();
      },
    },
  );
  hotkey.start();

  settings.onChange(value => broadcast([workspace, pet], 'edi:settings', value));
  let shownApproval: string | null = null;
  agent.onChange(state => {
    broadcast([workspace], 'edi:agent', state);
    if (state.status === 'running') pointer.dismiss(); // a new question clears the old answer
    character.setThinking(state.status === 'running' && !state.text && !state.approval);
    if (!state.approval && (state.status === 'running' || state.status === 'done')) {
      character.showReply(presentationText(state.text), state.status === 'done');
    }
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
  const presentPermissionGate = () => {
    const access = screenRecording.status();
    agent.rememberScreenAccess(access);
    if (access === 'granted') {
      if (
        systemPreferences.getMediaAccessStatus('microphone') !== 'granted' &&
        !workspace.isDestroyed()
      ) {
        workspace.webContents.send('edi:microphone-permission', 'blocked');
      } else {
        return;
      }
    }
    placement.show();
  };
  pet.once('ready-to-show', () => pet.showInactive());
  workspace.webContents.once('did-finish-load', presentPermissionGate);
  workspace.on('focus', () => {
    const access = screenRecording.status();
    agent.rememberScreenAccess(access);
    if (
      access === 'granted' &&
      systemPreferences.getMediaAccessStatus('microphone') !== 'granted' &&
      !workspace.isDestroyed()
    ) {
      workspace.webContents.send('edi:microphone-permission', 'blocked');
    }
  });
  workspace.on('close', event => {
    if (quitting) return;
    event.preventDefault();
    workspace.hide();
  });
  workspace.on('blur', () => {
    if (shouldHideCardOnBlur(settings.current.pinned, holdCard)) workspace.hide();
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
      requestMicrophoneAccess,
      requestScreenRecording,
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
