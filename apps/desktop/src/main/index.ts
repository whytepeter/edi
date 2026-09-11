import { app, BrowserWindow, ipcMain, Menu, screen, globalShortcut, session } from 'electron';
import { join } from 'node:path';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { commandSchema, defaultSettings, settingsSchema, type Settings } from '@edi/contracts';

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
    minWidth: 340, minHeight: 400, x: x + Math.max(0, width - 550), y: y + Math.max(0, height - 540),
    title: 'Edi', frame: false, transparent: true, backgroundColor: '#00000000', show: false,
    resizable: false, hasShadow: true, alwaysOnTop: true, webPreferences });
  pet = new BrowserWindow({ width: 140, height: 150, x: x + width - 160, y: y + height - 175,
    transparent: true, frame: false, hasShadow: false, resizable: false, alwaysOnTop: true,
    skipTaskbar: true, show: false, webPreferences });
  pet.setIgnoreMouseEvents(true, { forward: true });
  pet.once('ready-to-show', () => pet.showInactive());
  workspace.on('close', event => { if (!quitting) { event.preventDefault(); workspace.hide(); } });
  workspace.on('blur', () => { if (!settings.pinned) workspace.hide(); });
  load(workspace, 'workspace'); load(pet, 'pet');
}
let quitting = false;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => workspace?.show());
  void app.whenReady().then(async () => {
    try { settings = settingsSchema.parse(JSON.parse(await readFile(settingsPath(), 'utf8'))); } catch { /* first launch or invalid preferences */ }
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    createWindows();
    const trusted = (event: Electron.IpcMainInvokeEvent) => {
      if (![workspace.webContents, pet.webContents].includes(event.sender) || event.senderFrame !== event.sender.mainFrame) throw new Error('Untrusted window');
    };
    ipcMain.handle('edi:settings:get', event => { trusted(event); return settings; });
    ipcMain.handle('edi:command', async (event, raw: unknown) => {
      trusted(event);
      const command = commandSchema.parse(raw);
      if (command.type === 'pet-hit-test') {
        if (event.sender !== pet.webContents) throw new Error('Pet command only');
        pet.setIgnoreMouseEvents(!command.interactive, { forward: true }); return;
      }
      if (command.type === 'show-workspace') { workspace.show(); return; }
      if (event.sender !== workspace.webContents) throw new Error('Workspace command only');
      if (command.type === 'hide-workspace') workspace.hide();
      if (command.type === 'set-expanded') {
        const old = workspace.getBounds();
        const area = screen.getDisplayMatching(old).workArea;
        const width = Math.min(command.expanded ? 740 : 408, area.width);
        const height = Math.min(command.expanded ? 650 : 480, area.height);
        workspace.setBounds({ width, height,
          x: Math.max(area.x, Math.min(old.x + old.width - width, area.x + area.width - width)),
          y: Math.max(area.y, Math.min(old.y, area.y + area.height - height)) });
        return;
      }
      if (command.type === 'apply-skin') settings = { ...settings, skin: command.skin };
      if (command.type === 'set-pinned') settings = { ...settings, pinned: command.pinned };
      await persist(); publish();
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'Edi', submenu: [{ label: 'Show Edi', click: () => workspace.show() }, { type: 'separator' }, { role: 'quit' }] },
      { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
    ]));
    globalShortcut.register('CommandOrControl+Shift+E', () => workspace.isVisible() ? workspace.hide() : workspace.show());
    app.on('activate', () => workspace.show());
  });
}
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => globalShortcut.unregisterAll());
