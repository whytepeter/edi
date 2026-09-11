import { contextBridge, ipcRenderer } from 'electron';
import {
  commandSchema,
  settingsSchema,
  agentStateSchema,
  type DesktopBridge,
} from '@edi/contracts';

const bridge: DesktopBridge = {
  agent: async () => agentStateSchema.parse(await ipcRenderer.invoke('edi:agent:get')),
  onAgent: callback => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const parsed = agentStateSchema.safeParse(value);
      if (parsed.success) callback(parsed.data);
    };
    ipcRenderer.on('edi:agent', listener);
    return () => ipcRenderer.removeListener('edi:agent', listener);
  },
  settings: async () => settingsSchema.parse(await ipcRenderer.invoke('edi:settings:get')),
  command: async command => {
    await ipcRenderer.invoke('edi:command', commandSchema.parse(command));
  },
  onSettings: callback => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const parsed = settingsSchema.safeParse(value);
      if (parsed.success) callback(parsed.data);
    };
    ipcRenderer.on('edi:settings', listener);
    return () => ipcRenderer.removeListener('edi:settings', listener);
  },
};
contextBridge.exposeInMainWorld('edi', bridge);
