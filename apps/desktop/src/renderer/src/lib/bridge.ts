import type { DesktopBridge } from '@edi/contracts';

declare global {
  interface Window {
    /** Present in Electron; absent when the renderer is opened in a plain browser. */
    edi?: DesktopBridge;
  }
}

export type Command = Parameters<DesktopBridge['command']>[0];
