import { z } from 'zod';

export const skinSchema = z.enum(['cloud', 'sprout']);
export type SkinId = z.infer<typeof skinSchema>;
export const settingsSchema = z.object({ skin: skinSchema, pinned: z.boolean() });
export type Settings = z.infer<typeof settingsSchema>;
export const defaultSettings: Settings = { skin: 'cloud', pinned: false };
export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('show-workspace') }),
  z.object({ type: z.literal('hide-workspace') }),
  z.object({ type: z.literal('apply-skin'), skin: skinSchema }),
  z.object({ type: z.literal('set-pinned'), pinned: z.boolean() }),
  z.object({ type: z.literal('set-expanded'), expanded: z.boolean() }),
  z.object({ type: z.literal('pet-hit-test'), interactive: z.boolean() }),
]);
export type Command = z.infer<typeof commandSchema>;
export interface DesktopBridge {
  settings(): Promise<Settings>;
  command(command: Command): Promise<void>;
  onSettings(callback: (settings: Settings) => void): () => void;
}
export const skins = [
  { id: 'cloud', name: 'Cloud', description: 'A little curious. Always nearby.', color: '#759bea' },
  { id: 'sprout', name: 'Sprout', description: 'A softer shade of company.', color: '#759881' },
] as const;
