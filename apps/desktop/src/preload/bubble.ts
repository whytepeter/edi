import { contextBridge, ipcRenderer } from 'electron';

export interface BubbleText {
  text: string;
  done: boolean;
}

function asUpdate(value: unknown): BubbleText | undefined {
  if (typeof value === 'string' && value.length <= 600) return { text: value, done: false };
  if (!value || typeof value !== 'object') return undefined;
  const text = 'text' in value ? value.text : undefined;
  const done = 'done' in value ? value.done : undefined;
  if (typeof text !== 'string' || text.length > 600) return undefined;
  return { text, done: done === true };
}

// Receive-only bridge. The bubble cannot invoke IPC or control the desktop.
contextBridge.exposeInMainWorld('ediBubble', {
  subscribe(callback: (update: BubbleText) => void) {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const update = asUpdate(value);
      if (update) callback(update);
    };
    ipcRenderer.on('edi:bubble-text', listener);
    return () => ipcRenderer.removeListener('edi:bubble-text', listener);
  },
});
