import { app, BrowserWindow, ipcMain, Menu, screen, globalShortcut, session } from 'electron';
import { join } from 'node:path';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { commandSchema, defaultSettings, settingsSchema, desktopPetSize, clampWindow, type Settings } from '@edi/contracts';
import { AgentService } from './agent-service';
import { WindowPlacement } from './window-placement';
import { PetDrag } from './pet-drag';
import { CharacterActions } from './character-actions';

let agent: AgentService;
let placement: WindowPlacement;
let petDrag: PetDrag;
let character: CharacterActions;

let workspace: BrowserWindow;
let pet: BrowserWindow;
let settings: Settings = { ...defaultSettings };
let writes = Promise.resolve();
const settingsPath = () => join(app.getPath('userData'), 'preferences.json');

function persist() {
  const snapshot = JSON.stringify(settings);
  writes = writes.catch(() => {}).then(async () => {
    await mkdir(app.getPath('userData'), { recursive: true });
    await writeFile(`${settingsPath()}.tmp`, snapshot, { mode: 0o600 });
    await rename(`${settingsPath()}.tmp`, settingsPath());
  });
  return writes;
}
function publish() {
  for (const win of [workspace, pet]) if (!win.isDestroyed()) win.webContents.send('edi:settings', settings);
}
function load(win: BrowserWindow, surface: string) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/?surface=${surface}`);
  } else void win.loadFile(join(__dirname, '../renderer/index.html'), { query: { surface } });
}
function createWindows() {
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea;
  const webPreferences = { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true, nodeIntegration: false };
  workspace = new BrowserWindow({ width: Math.min(408, width), height: Math.min(480, height),
    x: x + Math.max(0, width - 550), y: y + Math.max(0, height - 540),
    title: 'Edi', frame: false, transparent: true, backgroundColor: '#00000000', show: false,
    resizable: false, hasShadow: true, alwaysOnTop: true, webPreferences });
  pet = new BrowserWindow({ ...desktopPetSize, x: x + width - desktopPetSize.width - 20, y: y + height - desktopPetSize.height - 25,
    transparent: true, frame: false, hasShadow: false, resizable: false, alwaysOnTop: true,
    skipTaskbar: true, show: false, webPreferences });
  pet.setIgnoreMouseEvents(true, { forward: true });
  if (settings.petPosition) {
    const restored = { ...settings.petPosition, ...desktopPetSize };
    pet.setBounds(clampWindow(restored, screen.getDisplayMatching(restored).workArea));
  }
  placement = new WindowPlacement(pet, workspace, () => settings.skin, () => settings.pinned);
  petDrag = new PetDrag(pet, () => placement.place(), async petPosition => {
    settings = { ...settings, petPosition };
    await persist();
    publish();
  });
  pet.webContents.on('render-process-gone', petDrag.cancel);
  screen.on('display-removed', petDrag.cancel);
  screen.on('display-metrics-changed', petDrag.cancel);
  placement.place();
  screen.on('display-removed', placement.recover);
  screen.on('display-metrics-changed', placement.recover);
  pet.once('ready-to-show', () => pet.showInactive());
  workspace.on('close', event => { if (!quitting) { event.preventDefault(); workspace.hide(); } });
  workspace.on('blur', () => { if (!settings.pinned) workspace.hide(); });
  load(workspace, 'workspace'); load(pet, 'pet');
  character = new CharacterActions(pet, workspace, () => placement.show(),
    () => { petDrag.cancel(); agent.stop(); }, () => {
      const bubble = new BrowserWindow({ width: 162, height: 48, show: false,
        transparent: true, frame: false, resizable: false, hasShadow: false,
        alwaysOnTop: true, skipTaskbar: true, focusable: false,
        webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
      load(bubble, 'voice-status');
      return bubble;
    }, () => app.quit(), () => {
      const menu = new BrowserWindow({ width: 260, height: 276, show: false,
        transparent: true, frame: false, resizable: false, hasShadow: false,
        alwaysOnTop: true, skipTaskbar: true, webPreferences });
      load(menu, 'character-menu');
      return menu;
    });
}
let quitting = false;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => character?.requestListening());
  void app.whenReady().then(async () => {
    try { settings = settingsSchema.parse(JSON.parse(await readFile(settingsPath(), 'utf8'))); } catch { /* first launch or invalid preferences */ }
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    agent = new AgentService(state => { if (!workspace.isDestroyed()) workspace.webContents.send('edi:agent', state); });
    await agent.load();
    createWindows();
    const trusted = (event: Electron.IpcMainInvokeEvent) => {
      if (![workspace.webContents, pet.webContents].includes(event.sender) || event.senderFrame !== event.sender.mainFrame) throw new Error('Untrusted window');
    };
    ipcMain.handle('edi:settings:get', event => { trusted(event); return settings; });
    ipcMain.handle('edi:agent:get', event => {
      trusted(event);
      if (event.sender !== workspace.webContents) throw new Error('Workspace command only');
      return agent.state;
    });
    ipcMain.handle('edi:command', async (event, raw: unknown) => {
      if (character.ownsMenu(event.sender) && event.senderFrame === event.sender.mainFrame) {
        const command = commandSchema.parse(raw);
        if (command.type !== 'character-action') throw new Error('Menu command only');
        character.action(command.action);
        return;
      }
      trusted(event);
      const command = commandSchema.parse(raw);
      if (command.type === 'request-listening' || command.type === 'release-listening' || command.type === 'character-menu') {
        if (event.sender !== pet.webContents) throw new Error('Pet command only');
        if (command.type === 'request-listening') {
          character.requestListening(command.mode);
          if (command.mode === 'push-to-talk') pet.setIgnoreMouseEvents(false);
        }
        else if (command.type === 'release-listening') {
          character.releaseListening();
          pet.setIgnoreMouseEvents(true, { forward: true });
        }
        else character.showMenu();
        return;
      }
      if (command.type === 'pet-drag') {
        if (event.sender !== pet.webContents) throw new Error('Pet command only');
        await petDrag.handle(command); return;
      }
      if (command.type === 'pet-hit-test') {
        if (event.sender !== pet.webContents) throw new Error('Pet command only');
        if (!petDrag.active) pet.setIgnoreMouseEvents(!command.interactive, { forward: true }); return;
      }
      if (command.type === 'show-workspace') { placement.show(); return; }
      if (event.sender !== workspace.webContents) throw new Error('Workspace command only');
      if (command.type === 'configure-agent') { await agent.configure(command.apiKey, command.model); return; }
      if (command.type === 'disconnect-agent') { await agent.disconnect(); return; }
      if (command.type === 'ask-agent') { agent.ask(command.prompt); return; }
      if (command.type === 'stop-agent') { agent.stop(); return; }
      if (command.type === 'hide-workspace') workspace.hide();
      if (command.type === 'set-expanded') {
        placement.place({ x: 0, y: 0, width: command.expanded ? 740 : 408, height: command.expanded ? 650 : 480 });
        return;
      }
      if (command.type === 'apply-skin') settings = { ...settings, skin: command.skin };
      if (command.type === 'set-pinned') settings = { ...settings, pinned: command.pinned };
      if (command.type === 'apply-skin' || command.type === 'set-pinned') placement.place();
      await persist(); publish();
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'Edi', submenu: character.menuItems() },
      { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
    ]));
    globalShortcut.register('CommandOrControl+Shift+E', () => character.requestListening());
    app.on('activate', () => character.requestListening());
  });
}
app.on('before-quit', () => { quitting = true; character?.dispose(); petDrag?.cancel(); agent?.stop(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
