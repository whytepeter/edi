/** Stroke icons on a 24px grid, drawn to sit beside SF Pro at text sizes. */
const paths = {
  expand: 'M14 4h6v6M20 4l-6 6M10 20H4v-6M4 20l6-6',
  collapse: 'M20 10h-6V4M14 10l6-6M4 14h6v6M10 14l-6 6',
  close: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
  back: 'M14.5 5.5L8 12l6.5 6.5',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  pin: 'M9.5 3.5h5l-.8 6.5 3.8 3.5v1.5h-11V13.5L10.3 10 9.5 3.5ZM12 15v5.5',
  check: 'M5.5 12.5l4 4 9-9.5',
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
  clock: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM12 8v4.5l3 2',
  waveform: 'M4 12h1M7.5 9v6M11 5.5v13M14.5 8v8M18 10.5v3M20.5 12h-.5',
  window:
    'M5.5 5.5h13a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1ZM4.5 9h15',
  stop: 'M7.5 6.5h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z',
  moon: 'M18.5 14.5A7 7 0 0 1 9.5 5.5a7 7 0 1 0 9 9Z',
  power: 'M12 4v7M7.5 7a7 7 0 1 0 9 0',
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
