import { useState } from 'react';
import './brand-icon.css';

/** Brand-colored icons for known apps; falls back to a colored initial. */

const brands: Record<string, { bg: string; fg: string; svg?: string }> = {
  gmail: {
    bg: '#ea4335',
    fg: '#fff',
    svg: 'M3 6l9 6 9-6M3 6v12h18V6',
  },
  slack: {
    bg: '#4a154b',
    fg: '#fff',
    svg: 'M6 14a2 2 0 1 1 0-4h4v4a2 2 0 0 1-4 0Zm8-4a2 2 0 1 1 0 4h-4v-4a2 2 0 0 1 4 0Zm-4 8a2 2 0 1 1 4 0v4h-4v-4a2 2 0 0 1 0 0Zm4-8a2 2 0 1 1-4 0V6h4v4a2 2 0 0 1 0 0Z',
  },
  linkedin: {
    bg: '#0a66c2',
    fg: '#fff',
    svg: 'M6 9v9M6 6v.01M10 18v-5c0-2 1-3 3-3s3 1 3 3v5M10 9v9',
  },
  github: {
    bg: '#24292f',
    fg: '#fff',
    svg: 'M12 3a9 9 0 0 0-2.84 17.54c.45.08.62-.2.62-.43v-1.5c-2.52.55-3.06-1.22-3.06-1.22a2.4 2.4 0 0 0-1-1.33c-.83-.57.06-.56.06-.56a1.92 1.92 0 0 1 1.4.94 1.95 1.95 0 0 0 2.66.76 1.93 1.93 0 0 1 .58-1.22c-2.01-.23-4.13-1-4.13-4.5a3.5 3.5 0 0 1 .94-2.44 3.27 3.27 0 0 1 .09-2.4s.77-.25 2.5.93a8.6 8.6 0 0 1 4.56 0c1.74-1.18 2.5-.93 2.5-.93a3.27 3.27 0 0 1 .09 2.4 3.5 3.5 0 0 1 .94 2.44c0 3.5-2.13 4.27-4.15 4.49a2.16 2.16 0 0 1 .62 1.69v2.5c0 .24.16.52.63.43A9 9 0 0 0 12 3Z',
  },
  notion: {
    bg: '#000',
    fg: '#fff',
    svg: 'M7 4h7l3 3v10a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm3 5v7M13 9v7',
  },
  linear: {
    bg: '#5e6ad2',
    fg: '#fff',
  },
  asana: {
    bg: '#f06a6a',
    fg: '#fff',
  },
  googlesheets: {
    bg: '#0f9d58',
    fg: '#fff',
    svg: 'M6 4h12v16H6V4Zm3 5h6M9 9v8M15 9v8M6 13h12',
  },
  googledrive: {
    bg: '#4285f4',
    fg: '#fff',
  },
  googlecalendar: {
    bg: '#4285f4',
    fg: '#fff',
    svg: 'M6 5h12a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm-1 5h14M9 3v4M15 3v4',
  },
  youtube: {
    bg: '#ff0000',
    fg: '#fff',
    svg: 'M4 8a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V8Zm6 0v8l6-4-6-4Z',
  },
  twitter: {
    bg: '#000',
    fg: '#fff',
    svg: 'M4 4l6.5 8.5L4 20M20 4l-6.5 8.5L20 20M4 4h5l11 16h-5',
  },
  outlook: {
    bg: '#0078d4',
    fg: '#fff',
    svg: 'M3 6l9 6 9-6M3 6v12h18V6',
  },
  jira: {
    bg: '#0052cc',
    fg: '#fff',
  },
  figma: {
    bg: '#a259ff',
    fg: '#fff',
    svg: 'M8 3h4v6H8a3 3 0 0 1 0-6Zm4 0h4a3 3 0 0 1 0 6h-4V3ZM8 9h4v6H8a3 3 0 0 1 0-6Zm8 3a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM8 15h4v3a3 3 0 0 1-6 0 3 3 0 0 1 2-2.82V15Z',
  },
  trello: {
    bg: '#0079bf',
    fg: '#fff',
    svg: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm2 3v8h4V7H7Zm6 0v5h4V7h-4Z',
  },
  hubspot: {
    bg: '#ff7a59',
    fg: '#fff',
  },
  microsoft_teams: { bg: '#5059c9', fg: '#fff' },
  zoom: { bg: '#0b5cff', fg: '#fff' },
  googlemeet: { bg: '#00897b', fg: '#fff' },
  calendly: { bg: '#006bff', fg: '#fff' },
  googledocs: { bg: '#4285f4', fg: '#fff' },
  googletasks: { bg: '#2684fc', fg: '#fff' },
  todoist: { bg: '#e44332', fg: '#fff' },
  clickup: { bg: '#7b68ee', fg: '#fff' },
  dropbox: { bg: '#0061ff', fg: '#fff' },
  one_drive: { bg: '#0078d4', fg: '#fff' },
  gitlab: { bg: '#fc6d26', fg: '#fff' },
  miro: { bg: '#ffd02f', fg: '#050038' },
  excel: { bg: '#217346', fg: '#fff' },
  airtable: { bg: '#18bfff', fg: '#fff' },
  reddit: { bg: '#ff4500', fg: '#fff' },
};

/**
 * Simple Icons slugs (https://simpleicons.org), drawn white on the brand tile. Slack, LinkedIn
 * and the Microsoft apps aren't in Simple Icons, so they keep a drawn glyph or their initial.
 */
const simpleIcons: Record<string, string> = {
  gmail: 'gmail',
  github: 'github',
  notion: 'notion',
  linear: 'linear',
  asana: 'asana',
  googlesheets: 'googlesheets',
  googledrive: 'googledrive',
  googlecalendar: 'googlecalendar',
  youtube: 'youtube',
  twitter: 'x',
  jira: 'jira',
  figma: 'figma',
  trello: 'trello',
  hubspot: 'hubspot',
  miro: 'miro',
  zoom: 'zoom',
  googlemeet: 'googlemeet',
  calendly: 'calendly',
  googledocs: 'googledocs',
  googletasks: 'googletasks',
  todoist: 'todoist',
  clickup: 'clickup',
  dropbox: 'dropbox',
  gitlab: 'gitlab',
  airtable: 'airtable',
  reddit: 'reddit',
};

/** Glyph colour when the tile is light (Miro's yellow). */
const darkGlyph = new Set(['miro']);

export function BrandIcon({ catalogId, name }: { catalogId: string | null; name: string }) {
  const [iconFailed, setIconFailed] = useState(false);
  const brand = catalogId ? brands[catalogId] : undefined;
  const slug = catalogId ? simpleIcons[catalogId] : undefined;
  const bg = brand?.bg ?? 'var(--fill-hover)';
  const fg = brand?.fg ?? 'var(--label)';
  const letter = name.slice(0, 1).toUpperCase();

  return (
    <span className="brand-icon" aria-hidden="true" style={{ background: bg, color: fg }}>
      {slug && !iconFailed ? (
        <img
          src={`https://cdn.simpleicons.org/${slug}/${darkGlyph.has(slug) ? '050038' : 'white'}`}
          alt=""
          width={16}
          height={16}
          draggable={false}
          referrerPolicy="no-referrer"
          onError={() => setIconFailed(true)}
        />
      ) : brand?.svg ? (
        <svg
          width={16}
          height={16}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={brand.svg} />
        </svg>
      ) : (
        letter
      )}
    </span>
  );
}
