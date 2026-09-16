import { z } from 'zod';

/**
 * Privacy mode: when Edi doesn't look at the screen or at what's in front. The person can pause
 * it, it pauses by itself while a call app shares the screen, and some apps are never looked at.
 */
export const privacyPauseSchema = z.enum(['you', 'sharing', 'private-app']);
export type PrivacyPause = z.infer<typeof privacyPauseSchema>;

export const privacyStateSchema = z
  .object({
    /** Why Edi isn't looking now; null when it may look. */
    paused: privacyPauseSchema.nullable(),
    /** The app sharing or recording the screen, when a share is noticed. */
    sharingApp: z.string().max(80).nullable(),
  })
  .strict();
export type PrivacyState = z.infer<typeof privacyStateSchema>;

/** An app Edi never looks at, chosen by the person (password managers always are). */
export const privateAppSchema = z
  .object({
    bundleId: z.string().regex(/^[A-Za-z0-9._-]{1,200}$/),
    name: z.string().trim().min(1).max(80),
  })
  .strict();
export type PrivateApp = z.infer<typeof privateAppSchema>;

/** One on-screen window, as the native helper lists them. Titles need Screen Recording. */
export interface OnScreenWindow {
  owner: string;
  bundleId?: string;
  name?: string;
  layer?: number;
}

const browsers = /chrome|safari|arc|edge|brave|firefox|opera|vivaldi|orion|zen/i;

/**
 * The bars and badges call apps put up while sharing. macOS has no API that says "the screen is
 * being shared", so this is best effort: known apps, by the window they show while sharing.
 */
const sharingSignals: { owner: RegExp; name: RegExp; app?: string }[] = [
  {
    owner: /^zoom\.us$/i,
    name: /share (tool|status) ?bar|screen ?shar|you are sharing|sharing screen/i,
    app: 'Zoom',
  },
  // Google Meet and other web calls: the browser's own "… is sharing your screen" bar.
  {
    owner: browsers,
    name: /is sharing (your screen|a window|this tab|a tab|your entire screen)|sharing this tab/i,
  },
  {
    owner: /microsoft teams/i,
    name: /sharing control bar|you['’]re sharing|you are presenting/i,
    app: 'Microsoft Teams',
  },
  { owner: /^slack$/i, name: /screen shar|you['’]re sharing/i, app: 'Slack' },
  { owner: /webex/i, name: /sharing|share control/i, app: 'Webex' },
  { owner: /^facetime$/i, name: /screen shar|shareplay/i, app: 'FaceTime' },
  { owner: /discord/i, name: /screen share|you['’]re streaming|go live/i, app: 'Discord' },
  { owner: /^quicktime player$/i, name: /screen recording/i, app: 'QuickTime Player' },
];

/** The app sharing or recording the screen, when one of the known signs is on screen. */
export function screenSharingApp(windows: readonly OnScreenWindow[]): string | null {
  for (const window of windows) {
    const name = window.name;
    if (!name) continue;
    const match = sharingSignals.find(
      signal => signal.owner.test(window.owner) && signal.name.test(name),
    );
    if (match) return (match.app ?? window.owner).slice(0, 80);
  }
  return null;
}

/** Why Edi isn't looking, in a sentence for the model and for Settings; null when it is. */
export function privacyReason(state: PrivacyState): string | null {
  if (state.paused === 'you') return 'The user paused it (privacy mode).';
  if (state.paused === 'sharing')
    return `The user is sharing their screen${state.sharingApp ? ` in ${state.sharingApp}` : ''}.`;
  if (state.paused === 'private-app') return 'An app the user keeps private is in front.';
  return null;
}
