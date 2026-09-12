import { skins, type DesktopBridge, type SkinId } from '@edi/contracts';

declare global {
  interface Window {
    /** Present in Electron; absent when the renderer is opened in a plain browser. */
    edi?: DesktopBridge;
  }
}

export type Command = Parameters<DesktopBridge['command']>[0];

export function accentFor(skin: SkinId) {
  return skins.find(entry => entry.id === skin)?.color ?? skins[0].color;
}
