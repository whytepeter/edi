import { z } from 'zod';

/**
 * Subtle suggestions: a quiet line beside the character when something Edi already knows would
 * plainly help — an app in front that isn't connected, or a skill made for it. Everything here is
 * decided on this Mac from the app in front and, in a browser, the site's name. No screenshot is
 * taken, nothing is sent anywhere, and no model is asked.
 */
export const suggestionLevelSchema = z.enum(['off', 'subtle', 'helpful']);
export type SuggestionLevel = z.infer<typeof suggestionLevelSchema>;

export const suggestionSchema = z
  .object({
    /** Stable per subject, so the same suggestion is only made again after its cooldown. */
    key: z.string().min(1).max(120),
    kind: z.enum(['connect-app', 'use-skill']),
    /** The line shown beside the character. */
    text: z.string().min(1).max(160),
    /** What the button does, and what it says. */
    action: z.object({ label: z.string().min(1).max(40), appId: z.string().max(80).optional() }),
  })
  .strict();
export type Suggestion = z.infer<typeof suggestionSchema>;

/** What the room looks like right now, from signals Edi already has. */
export interface SuggestionMoment {
  /** The app in front, by bundle id and name. */
  app: { bundleId: string | null; name: string };
  /** The site in a browser's front window, when Accessibility gives its address. */
  host: string | null;
  /** Catalog ids of apps that can be connected but aren't. */
  connectable: readonly { id: string; name: string }[];
  /** Switched-on skills and the catalog ids each works with. */
  skills: readonly { name: string; title: string; apps: readonly string[] }[];
  /** Keys already suggested, with when; a key inside its cooldown is not repeated. */
  shownAt: ReadonlyMap<string, number>;
  now: number;
}

/** A suggestion is not repeated for this long, whether or not it was taken. */
export const suggestionCooldownMs = 7 * 24 * 60 * 60 * 1000;
/** Nothing at all in the first moments after Edi starts: it would arrive before the person looks. */
export const suggestionQuietStartMs = 60_000;

/**
 * Which catalog app a window belongs to: the desktop app by bundle id, or the site in a browser.
 * Kept here so the rules stay testable and the same names are used everywhere.
 */
const appsByBundleId: Record<string, string> = {
  'com.tinyspeck.slackmacgap': 'slack',
  'com.hnc.Discord': 'discord',
  'notion.id': 'notion',
  'com.linear': 'linear',
  'com.electron.asana': 'asana',
  'com.todoist.mac.Todoist': 'todoist',
  'com.figma.Desktop': 'figma',
  'com.microsoft.teams2': 'microsoft_teams',
  'com.microsoft.Outlook': 'outlook',
  'us.zoom.xos': 'zoom',
  'com.github.GitHubClient': 'github',
};

const appsByHost: Record<string, string> = {
  'mail.google.com': 'gmail',
  'calendar.google.com': 'googlecalendar',
  'docs.google.com': 'googledocs',
  'drive.google.com': 'googledrive',
  'meet.google.com': 'googlemeet',
  'tasks.google.com': 'googletasks',
  'github.com': 'github',
  'gitlab.com': 'gitlab',
  'linear.app': 'linear',
  'notion.so': 'notion',
  'www.notion.so': 'notion',
  'app.asana.com': 'asana',
  'app.slack.com': 'slack',
  'todoist.com': 'todoist',
  'app.todoist.com': 'todoist',
  'trello.com': 'trello',
  'www.linkedin.com': 'linkedin',
  'outlook.office.com': 'outlook',
  'outlook.live.com': 'outlook',
  'www.figma.com': 'figma',
  'calendly.com': 'calendly',
  'app.clickup.com': 'clickup',
  'www.dropbox.com': 'dropbox',
};

/** The catalog app the person is looking at, or null. */
export function appInFront(moment: Pick<SuggestionMoment, 'app' | 'host'>): string | null {
  const byBundle = moment.app.bundleId ? appsByBundleId[moment.app.bundleId] : undefined;
  if (byBundle) return byBundle;
  const host = moment.host?.toLowerCase();
  if (!host) return null;
  return appsByHost[host] ?? appsByHost[host.replace(/^www\./, '')] ?? null;
}

/**
 * The one thing worth saying now, or null — which is the usual answer. Only two rules so far:
 * an app in front Edi could connect, and a switched-on skill made for that app.
 */
export function suggestNow(
  level: SuggestionLevel,
  moment: SuggestionMoment,
): Suggestion | null {
  if (level === 'off') return null;
  const appId = appInFront(moment);
  if (!appId) return null;
  const fresh = (key: string) => {
    const shown = moment.shownAt.get(key);
    return shown === undefined || moment.now - shown >= suggestionCooldownMs;
  };

  const connectable = moment.connectable.find(app => app.id === appId);
  if (connectable && fresh(`connect:${appId}`))
    return {
      key: `connect:${appId}`,
      kind: 'connect-app',
      text: `Connect ${connectable.name} so I can help with it?`,
      action: { label: 'Connect', appId },
    };

  // Only at the fuller level: a skill is useful, but less pressing than a missing connection.
  if (level !== 'helpful') return null;
  const skill = moment.skills.find(entry => entry.apps.includes(appId));
  if (skill && fresh(`skill:${skill.name}:${appId}`))
    return {
      key: `skill:${skill.name}:${appId}`,
      kind: 'use-skill',
      text: `I have a ${skill.title} skill for ${connectable?.name ?? moment.app.name}. Want it?`,
      action: { label: 'Show me' },
    };
  return null;
}
