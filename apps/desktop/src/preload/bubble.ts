import { contextBridge, ipcRenderer } from 'electron';

// Receive-only bridge. The bubble cannot invoke IPC or control the desktop.
contextBridge.exposeInMainWorld('ediBubble', {
  subscribe(callback: (text: string) => void) {
    const listener = (_event: Electron.IpcRendererEvent, text: unknown) => {
      if (typeof text === 'string' && text.length <= 600) callback(text);
    };
    ipcRenderer.on('edi:bubble-text', listener);
    return () => ipcRenderer.removeListener('edi:bubble-text', listener);
  },
});
