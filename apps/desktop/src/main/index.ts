import { app, globalShortcut, Menu, screen, session } from 'electron';
import { AgentService } from './agent-service';
import { CharacterActions } from './character-actions';
import { createCommandRoutes } from './commands';
import { registerIpc } from './ipc';
import { PetDrag } from './pet-drag';
import { SettingsStore } from './settings-store';
import { WindowPlacement } from './window-placement';
import {
  broadcast,
  createCharacterMenuWindow,
  createPetWindow,
  createVoiceStatusWindow,
  createWorkspaceWindow,
} from './windows';

let quitting = false;

/** Composition root: construct services, wire them together, own app lifecycle. */
async function start() {
  const settings = new SettingsStore();
  const agent = new AgentService();
  await Promise.all([settings.load(), agent.load()]);

  // Nothing is granted until a feature asks for exactly what it needs.
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );

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
  const character = new CharacterActions(
    pet,
    workspace,
    () => placement.show(),
    () => {
      petDrag.cancel();
      agent.stop();
    },
    createVoiceStatusWindow,
    () => app.quit(),
    createCharacterMenuWindow,
  );

  settings.onChange(value => broadcast([workspace, pet], 'edi:settings', value));
  agent.onChange(state => broadcast([workspace], 'edi:agent', state));

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
    }),
    settings: () => settings.current,
    agentState: () => agent.state,
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
}

if (!app.requestSingleInstanceLock()) app.quit();
else void app.whenReady().then(start);
app.on('will-quit', () => globalShortcut.unregisterAll());
