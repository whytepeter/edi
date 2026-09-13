import { skins, type DesktopBridge, type SkinId } from '@edi/contracts';

declare global {
  interface Window {
    /** Present in Electron; absent when the renderer is opened in a plain browser. */
    edi?: DesktopBridge;
  }
}

export type Command = Parameters<DesktopBridge['command']>[0];

const skinFor = (skin: SkinId) => skins.find(entry => entry.id === skin) ?? skins[0];

/** The theme color the card, bubbles and pointer take on for this character. */
export function accentFor(skin: SkinId) {
  return skinFor(skin).accent;
}

/** The character's outline color. */
export function inkFor(skin: SkinId) {
  return skinFor(skin).color;
}
