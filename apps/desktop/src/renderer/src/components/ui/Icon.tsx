/** Stroke icons on a 24px grid, drawn to sit beside SF Pro at text sizes. */
const paths = {
  expand: 'M14 4h6v6M20 4l-6 6M10 20H4v-6M4 20l6-6',
  collapse: 'M20 10h-6V4M14 10l6-6M4 14h6v6M10 14l-6 6',
  close: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
  plus: 'M12 5v14M5 12h14',
  back: 'M14.5 5.5L8 12l6.5 6.5',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  pin: 'M9.5 3.5h5l-.8 6.5 3.8 3.5v1.5h-11V13.5L10.3 10 9.5 3.5ZM12 15v5.5',
  check: 'M5.5 12.5l4 4 9-9.5',
  copy: 'M9.5 8.5h9A1.5 1.5 0 0 1 20 10v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 8 19v-9a1.5 1.5 0 0 1 1.5-1.5ZM16 8.5V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8',
  download: 'M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14',
  code: 'M8.5 7.5 4 12l4.5 4.5M15.5 7.5 20 12l-4.5 4.5M13.5 5.5l-3 13',
  play: 'M8.5 6.3v11.4a.8.8 0 0 0 1.2.7l9-5.7a.8.8 0 0 0 0-1.4l-9-5.7a.8.8 0 0 0-1.2.7Z',
  trash:
    'M5 7h14M10 7V5.5A1.5 1.5 0 0 1 11.5 4h1A1.5 1.5 0 0 1 14 5.5V7M7 7l.8 11.6A1.5 1.5 0 0 0 9.3 20h5.4a1.5 1.5 0 0 0 1.5-1.4L17 7M10.5 11v5M13.5 11v5',
  'arrow-up-right': 'M7.5 16.5l9-9M9 7.5h7.5V15',
  'arrow-up': 'M12 19V6M6.5 11.5 12 6l5.5 5.5',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM15.3 15.3 20 20',
  chat: 'M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6a2.5 2.5 0 0 1-2.5 2.5H10l-4 3.5V15h1.5',
  face: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM9.5 10v1M14.5 10v1M9 14.5c1.6 1.4 4.4 1.4 6 0',
  sparkles:
    'M11 4l1.6 4.4L17 10l-4.4 1.6L11 16l-1.6-4.4L5 10l4.4-1.6L11 4ZM18 15l.7 1.8 1.8.7-1.8.7L18 20l-.7-1.8-1.8-.7 1.8-.7L18 15Z',
  notes:
    'M7 4.5h10A1.5 1.5 0 0 1 18.5 6v12a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 18V6A1.5 1.5 0 0 1 7 4.5ZM9 9h6M9 12.5h6M9 16h3.5',
  calendar:
    'M6.5 5.5h11A1.5 1.5 0 0 1 19 7v11a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18V7a1.5 1.5 0 0 1 1.5-1.5ZM5 10h14M9 3.5v4M15 3.5v4',
  plug: 'M9 3.5V8M15 3.5V8M7 8h10v3a5 5 0 0 1-10 0V8ZM12 16v4.5',
  chart: 'M5 19.5h14M7.5 16v-4M12 16V7.5M16.5 16v-6',
  tasks:
    'M10 6.5h9.5M10 12h9.5M10 17.5h9.5M4.5 6.5l1.2 1.2 2.3-2.4M4.5 12l1.2 1.2 2.3-2.4M4.5 17.5l1.2 1.2 2.3-2.4',
  compose:
    'M13.5 5.5H7A1.5 1.5 0 0 0 5.5 7v10A1.5 1.5 0 0 0 7 18.5h10a1.5 1.5 0 0 0 1.5-1.5v-6.5M17 4.5l2.5 2.5-7 7H10v-2.5l7-7Z',
  clock: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM12 8v4.5l3 2',
  waveform: 'M4 12h1M7.5 9v6M11 5.5v13M14.5 8v8M18 10.5v3M20.5 12h-.5',
  window:
    'M5.5 5.5h13a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1ZM4.5 9h15',
  stop: 'M7.5 6.5h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z',
  moon: 'M18.5 14.5A7 7 0 0 1 9.5 5.5a7 7 0 1 0 9 9Z',
  power: 'M12 4v7M7.5 7a7 7 0 1 0 9 0',
  home: 'M4.5 11 12 4.5l7.5 6.5M6.5 9.5V19h11V9.5M10 19v-5h4v5',
  'chevron-down': 'M7.5 10l4.5 4.5 4.5-4.5',
  'chevron-right': 'M10 7l5 5-5 5',
  sliders: 'M5 7.5h8M17 7.5h2M5 16.5h2M11 16.5h8M15 5.5v4M9 14.5v4',
  library: 'M5 5h3v14H5V5ZM10.5 5h3v14h-3V5ZM15.8 5.9l2.9-.7 2.8 13.1-2.9.7-2.8-13.1Z',
  cpu: 'M8 8h8v8H8V8ZM10 4.5V8M14 4.5V8M10 16v3.5M14 16v3.5M4.5 10H8M4.5 14H8M16 10h3.5M16 14h3.5',
  keyboard:
    'M4.5 7h15a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1ZM7.5 10.5h.01M10.5 10.5h.01M13.5 10.5h.01M16.5 10.5h.01M8.5 14h7',
  shield: 'M12 3.5l7 2.5v5.5c0 4.3-3 7.6-7 9-4-1.4-7-4.7-7-9V6l7-2.5Z',
  mic: 'M12 4a2.5 2.5 0 0 1 2.5 2.5v5a2.5 2.5 0 0 1-5 0v-5A2.5 2.5 0 0 1 12 4ZM6.5 11a5.5 5.5 0 0 0 11 0M12 16.5V20',
  info: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM12 11v5M12 8h.01',
  folder:
    'M4.5 7A1.5 1.5 0 0 1 6 5.5h3.5l2 2H18A1.5 1.5 0 0 1 19.5 9v8a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 17V7Z',
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="ds-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === 'more' ? 3.2 : 1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
