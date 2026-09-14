/**
 * Edi: a soft-shaded chibi with a faded buzz cut, winged eyes, glossy lips and gold hoops.
 * This file only generates `edi/art.svg`; the app reads that file like any installed package.
 * Every expression is a variant of a part (see docs/characters/README.md).
 */
import type { ReactNode } from 'react';
import { mirrorX, side, sides, turn, type Side } from './shapes';

const c = {
  outline: '#3b2016',
  skinLight: '#d6a075',
  skin: '#bb7a4e',
  skinShade: '#94583a',
  hair: '#2b170e',
  brow: '#35190f',
  white: '#fbf4ee',
  irisLight: '#8a5230',
  iris: '#4d2716',
  irisDark: '#1f0e07',
  pupil: '#110704',
  liner: '#150a06',
  shadow: '#8a4f35',
  blush: '#e0645a',
  lipLight: '#d98476',
  lip: '#a9524c',
  lipDark: '#7e3639',
  mouth: '#4f1a20',
  tongue: '#d9837a',
  heart: '#d9486a',
  tear: '#cdeaf7',
  tearLine: '#6aa9c9',
  goldLight: '#f6d27a',
  gold: '#d6a13a',
  goldDark: '#9c6a1c',
};

export const ediHead =
  'M80 22C116 22 140 47 141 82C142 106 135 125 121 137C109 146 95 149 80 149C65 149 51 146 39 137C25 125 18 106 19 82C20 47 44 22 80 22Z';

function Defs() {
  const hairTransform = 'translate(80 96) scale(66 76)';
  return (
    <defs>
      <radialGradient id="skin" cx="0.4" cy="0.32" r="0.78">
        <stop offset="0" stopColor={c.skinLight} />
        <stop offset="0.55" stopColor={c.skin} />
        <stop offset="1" stopColor={c.skinShade} />
      </radialGradient>
      <linearGradient id="lid" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={c.skinShade} />
        <stop offset="1" stopColor={c.skin} />
      </linearGradient>
      <radialGradient
        id="hair"
        gradientUnits="userSpaceOnUse"
        cx="0"
        cy="0"
        r="1"
        gradientTransform={hairTransform}
      >
        <stop offset="0.66" stopColor={c.hair} stopOpacity="0" />
        <stop offset="0.86" stopColor={c.hair} stopOpacity="0.34" />
        <stop offset="1" stopColor={c.hair} stopOpacity="0.55" />
      </radialGradient>
      <radialGradient
        id="hair-density"
        gradientUnits="userSpaceOnUse"
        cx="0"
        cy="0"
        r="1"
        gradientTransform={hairTransform}
      >
        <stop offset="0.7" stopColor="#fff" stopOpacity="0" />
        <stop offset="1" stopColor="#fff" />
      </radialGradient>
      <linearGradient id="hair-fade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0.45" stopColor="#fff" />
        <stop offset="0.64" stopColor="#fff" stopOpacity="0" />
      </linearGradient>
      <mask id="hair-mask" maskContentUnits="userSpaceOnUse">
        <rect x="0" y="20" width="160" height="130" fill="url(#hair-fade)" />
      </mask>
      <mask id="buzz-mask" maskContentUnits="userSpaceOnUse">
        <rect x="0" y="0" width="160" height="170" fill="url(#hair-density)" />
      </mask>
      <pattern id="buzz" width="6" height="6" patternUnits="userSpaceOnUse">
        <circle cx="1" cy="1.2" r="0.55" fill={c.hair} />
        <circle cx="4.2" cy="2.4" r="0.5" fill={c.hair} />
        <circle cx="2.6" cy="4.6" r="0.55" fill={c.hair} />
        <circle cx="5.3" cy="5.2" r="0.45" fill={c.hair} />
      </pattern>
      <radialGradient id="shine">
        <stop offset="0" stopColor="#fff" stopOpacity="0.42" />
        <stop offset="1" stopColor="#fff" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="blush">
        <stop offset="0" stopColor={c.blush} stopOpacity="0.55" />
        <stop offset="1" stopColor={c.blush} stopOpacity="0" />
      </radialGradient>
      <radialGradient id="blush-strong">
        <stop offset="0" stopColor={c.blush} stopOpacity="0.85" />
        <stop offset="1" stopColor={c.blush} stopOpacity="0" />
      </radialGradient>
      <radialGradient id="iris" cx="0.45" cy="0.6" r="0.6">
        <stop offset="0" stopColor={c.irisLight} />
        <stop offset="0.55" stopColor={c.iris} />
        <stop offset="1" stopColor={c.irisDark} />
      </radialGradient>
      <linearGradient id="upper-lip" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={c.lip} />
        <stop offset="1" stopColor={c.lipDark} />
      </linearGradient>
      <radialGradient id="lower-lip" cx="0.55" cy="0.35" r="0.7">
        <stop offset="0" stopColor={c.lipLight} />
        <stop offset="1" stopColor={c.lip} />
      </radialGradient>
      <linearGradient id="hand" x1="0.2" y1="0" x2="0.5" y2="1">
        <stop offset="0" stopColor={c.skinLight} />
        <stop offset="0.5" stopColor={c.skin} />
        <stop offset="1" stopColor={c.skinShade} />
      </linearGradient>
      <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor={c.goldLight} />
        <stop offset="0.5" stopColor={c.gold} />
        <stop offset="1" stopColor={c.goldDark} />
      </linearGradient>
      <clipPath id="head">
        <path d={ediHead} />
      </clipPath>
      {sides.map(which => (
        <clipPath key={which} id={`eye-${which}`}>
          <path d={side(almond.default, which)} />
        </clipPath>
      ))}
      {sides.map(which => (
        <clipPath key={which} id={`eye-wide-${which}`}>
          <path d={side(almond.wide, which)} />
        </clipPath>
      ))}
      {sides.map(which => (
        <clipPath key={which} id={`eye-sad-${which}`}>
          <path d={side(almond.sad, which)} />
        </clipPath>
      ))}
    </defs>
  );
}

function Head() {
  return (
    <>
      <ellipse cx="80" cy="162" rx="40" ry="5" fill={c.outline} opacity="0.09" />
      {sides.map(which => (
        <g key={`hoop-${which}`} fill="none">
          <circle cx={mirrorX(17, which)} cy="127" r="13.5" stroke={c.goldDark} strokeWidth="4.4" />
          <circle cx={mirrorX(17, which)} cy="127" r="13.5" stroke="url(#gold)" strokeWidth="3" />
          <path
            d={side('M7 120C9 116 13 114 17 113.5', which)}
            stroke={c.goldLight}
            strokeWidth="1"
            strokeOpacity="0.9"
            strokeLinecap="round"
          />
        </g>
      ))}
      {sides.map(which => (
        <g key={`ear-${which}`}>
          <path
            d={side('M26 92C18 86 9 90 9 100C9 109 14 116 22 117C25 117 27 115 28 113Z', which)}
            fill="url(#skin)"
            stroke={c.outline}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            d={side('M22 95C16 94 14 99 15 104C16 108 19 110 22 110', which)}
            stroke={c.skinShade}
            strokeWidth="1.6"
            strokeLinecap="round"
            fill="none"
          />
        </g>
      ))}
      <path d={ediHead} fill="url(#skin)" stroke={c.outline} strokeWidth="2.2" />
      <g clipPath="url(#head)">
        <g mask="url(#hair-mask)">
          <path d={ediHead} fill="url(#hair)" />
          <path d={ediHead} fill="url(#buzz)" mask="url(#buzz-mask)" opacity="0.45" />
        </g>
        <path
          d="M18 96C22 124 46 150 80 150C114 150 138 124 142 96C136 130 112 146 80 146C48 146 24 130 18 96Z"
          fill={c.skinShade}
          opacity="0.35"
        />
      </g>
      <ellipse cx="60" cy="44" rx="22" ry="10" transform="rotate(-24 60 44)" fill="url(#shine)" />
    </>
  );
}

function Cheeks() {
  return (
    <g data-part="cheeks">
      <g data-variant="default">
        <ellipse cx="41" cy="121" rx="15" ry="10" fill="url(#blush)" />
        <ellipse cx="119" cy="121" rx="15" ry="10" fill="url(#blush)" />
      </g>
      <g data-variant="love">
        {sides.map(which => (
          <g key={which}>
            <ellipse cx={mirrorX(41, which)} cy="121" rx="17" ry="11" fill="url(#blush-strong)" />
            <path
              d={side('M34 121L37 117M39 122L42 118M44 123L47 119', which)}
              stroke={c.blush}
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </g>
        ))}
      </g>
    </g>
  );
}

/** A brow, feathered and tapering past the arch; `transform` tilts or lifts it per mood. */
function Brow({ which, transform }: { which: Side; transform?: string }) {
  return (
    <g transform={transform}>
      <path
        d={side(
          'M70 82C64 76 56 70 47 70.5C40 71 35 75 32 81C38 76 44 74.5 51 75.5C58 76.5 64 79.5 70 84.5Z',
          which,
        )}
        fill={c.brow}
      />
      <path
        d={side('M66 79L62 74.5M60 76.5L56.5 72.5M54 74.5L51 71.5M47 73.5L45 71', which)}
        stroke={c.brow}
        strokeWidth="0.9"
        strokeOpacity="0.7"
        strokeLinecap="round"
      />
    </g>
  );
}

/** One brow pose per variant, as a lift (y) and a tilt that raises (+) the inner end. */
const browPoses: Record<string, { left: [number, number]; right: [number, number] }> = {
  default: { left: [0, 0], right: [0, 0] },
  happy: { left: [-2, 0], right: [-2, 0] },
  love: { left: [-2, 0], right: [-2, 0] },
  listening: { left: [-2.5, 0], right: [-2.5, 0] },
  attention: { left: [-3, 0], right: [-3, 0] },
  thinking: { left: [-3.5, -4], right: [0.5, 3] },
  sad: { left: [-1, 14], right: [-1, 14] },
  sigh: { left: [0, 8], right: [0, 8] },
  surprised: { left: [-6.5, 2], right: [-6.5, 2] },
  confused: { left: [-5, -6], right: [1.5, 10] },
  annoyed: { left: [2.5, -16], right: [2.5, -16] },
  sleepy: { left: [1.5, 3], right: [1.5, 3] },
};

function Brows() {
  return (
    <g data-part="brows">
      {Object.entries(browPoses).map(([variant, pose]) => (
        <g key={variant} data-variant={variant}>
          {sides.map(which => {
            const [lift, tilt] = pose[which];
            // For the left brow the inner end is on the right, so raising it turns it anticlockwise.
            return (
              <Brow
                key={which}
                which={which}
                transform={`translate(0 ${lift}) ${turn(-tilt, 51, 77, which)}`}
              />
            );
          })}
        </g>
      ))}
    </g>
  );
}

const almond = {
  default: 'M37 102.5C42 91 62 90 69 104C62 112 44 113 37 102.5Z',
  wide: 'M36 101C40 86 64 85 70 102C64 114 42 115 36 101Z',
  sad: 'M37 105C42 94 62 91 69 104C62 112 44 114 37 105Z',
};
const lashes =
  'M36.5 95Q33.5 94 30.1 93.8Q33.5 94.9 36 96.5ZM39.7 92.4Q37 90.7 33.7 89.9Q36.8 91.6 38.8 93.8ZM43.5 90.7Q41.2 88.6 38.1 87.3Q40.8 89.4 42.3 91.8ZM47.6 89.9Q45.9 87.4 43.2 85.8Q45.3 88.2 46.3 90.8ZM52 90Q50.9 87.6 48.6 85.9Q50.2 88.2 50.5 90.6ZM56.4 91Q55.8 89.1 53.9 87.6Q55 89.5 54.8 91.4Z';

function Iris({
  which,
  dy = 0,
  pupil = 4.4,
  heart = false,
}: {
  which: Side;
  dy?: number;
  pupil?: number;
  heart?: boolean;
}) {
  const cx = mirrorX(53, which);
  const cy = 102 + dy;
  if (heart)
    return (
      <g data-part="pupils">
        <path
          d={`M${cx} ${cy + 8}C${cx - 8} ${cy + 2} ${cx - 9.5} ${cy - 2.5} ${cx - 7} ${cy - 5.5}C${cx - 4.5} ${cy - 8.5} ${cx - 1.2} ${cy - 7.5} ${cx} ${cy - 5}C${cx + 1.2} ${cy - 7.5} ${cx + 4.5} ${cy - 8.5} ${cx + 7} ${cy - 5.5}C${cx + 9.5} ${cy - 2.5} ${cx + 8} ${cy + 2} ${cx} ${cy + 8}Z`}
          fill={c.heart}
        />
        <circle cx={cx + 3.4} cy={cy - 4} r="1.9" fill="#fff" />
      </g>
    );
  return (
    <g data-part="pupils">
      <circle cx={cx} cy={cy} r="9.6" fill="url(#iris)" />
      <circle cx={cx} cy={cy} r={pupil} fill={c.pupil} />
      <circle cx={cx + 3.6} cy={cy - 3.6} r="2.7" fill="#fff" />
      <circle cx={cx - 3.2} cy={cy + 3.8} r="1.1" fill="#fff" fillOpacity="0.8" />
    </g>
  );
}

/** An open eye: shadow and crease, white, iris, lid shadow, liner with wing, lashes. */
function OpenEye({
  which,
  shape = 'default',
  iris,
  lid,
}: {
  which: Side;
  shape?: keyof typeof almond;
  iris?: ReactNode;
  /** A skin-colored upper lid that lowers over the eye (sleepy, annoyed). */
  lid?: { cover: string; edge: string };
}) {
  const clip =
    shape === 'default' ? `eye-${which}` : `eye-${shape === 'wide' ? 'wide' : 'sad'}-${which}`;
  const liner = {
    default:
      'M70 104.5C62 85.5 40 85.5 34 98.5L24.5 93C29 98 33 100.5 37 102.5C42 91 62 90 70 104.5Z',
    wide: 'M71 102.5C63 82.5 39 82.5 34 97.5L26 93.5C30 98 33 100 36 101C40 86 64 85 71 102.5Z',
    sad: 'M70 104.5C62 86.5 41 88 34 101L30.5 103C34 103 35.5 104 37 105C42 94 62 91 70 104.5Z',
  }[shape];
  const lashShift = { default: '', wide: 'translate(0 -2.5)', sad: turn(-8, 53, 96, which) }[shape];
  return (
    <>
      <path
        d={side('M34 97C40 82 62 80 71 102C63 91 43 89 37 102.5Z', which)}
        fill={c.shadow}
        opacity="0.3"
      />
      <path d={side(almond[shape], which)} fill={c.white} />
      <g clipPath={`url(#${clip})`}>
        {iris ?? <Iris which={which} />}
        <path
          d={side('M36 102.5C42 91 62 90 70 104.5C62 97.5 43 96.5 36 102.5Z', which)}
          fill={c.shadow}
          opacity="0.35"
        />
        {lid && <path d={side(lid.cover, which)} fill="url(#lid)" />}
      </g>
      <path
        d={side('M38 102.5C45 112 61 111.5 68 105', which)}
        stroke={c.brow}
        strokeWidth="0.9"
        strokeOpacity="0.6"
        strokeLinecap="round"
      />
      {lid ? (
        <path
          d={side(lid.edge, which)}
          stroke={c.liner}
          strokeWidth="2.8"
          strokeLinecap="round"
          fill="none"
        />
      ) : (
        <>
          <path d={side(liner, which)} fill={c.liner} stroke={c.liner} strokeWidth="0.6" />
          <path d={side(lashes, which)} fill={c.liner} transform={lashShift || undefined} />
        </>
      )}
    </>
  );
}

/** Closed eyes: an arc (smiling when `up`), the wing, and a few lashes. */
function ClosedEye({ which, up }: { which: Side; up: boolean }) {
  return (
    <g stroke={c.liner} fill="none" strokeLinecap="round">
      <path
        d={side(up ? 'M37 102Q53 86 69 102' : 'M37 101Q53 110 69 102', which)}
        strokeWidth="3.2"
      />
      <path d={side(up ? 'M38 101L28 95' : 'M38 101.5L29 100', which)} strokeWidth="2.4" />
      <path
        d={side(
          up
            ? 'M43 94.5Q39.5 90 36.5 89M50 91Q48.5 86 46 84.5'
            : 'M44 106Q42 109.5 39.5 110.5M51 107.5Q50.5 111 48.5 112.5',
          which,
        )}
        strokeWidth="1.1"
      />
    </g>
  );
}

const sleepyLid = {
  cover: 'M30 80L76 80L76 104.5C66 98.5 46 98 35 103.5Z',
  edge: 'M36 103.2C46 98.2 63 98.6 70 104.3',
};
const annoyedLid = {
  cover: 'M30 80L76 80L76 103.5C62 100.5 46 99 35 99.5Z',
  edge: 'M35.5 99.8C46 99 61 100.6 70.5 103.8',
};

function Eyes() {
  const both = (render: (which: Side) => ReactNode) =>
    sides.map(which => <g key={which}>{render(which)}</g>);
  return (
    <g data-part="eyes">
      <g data-variant="default">
        {both(which => (
          <OpenEye which={which} />
        ))}
      </g>
      <g data-variant="happy">
        {both(which => (
          <ClosedEye which={which} up />
        ))}
      </g>
      <g data-variant="sigh">
        {both(which => (
          <ClosedEye which={which} up={false} />
        ))}
      </g>
      <g data-variant="surprised">
        {both(which => (
          <OpenEye which={which} shape="wide" iris={<Iris which={which} pupil={2.8} />} />
        ))}
      </g>
      <g data-variant="sad">
        {both(which => (
          <OpenEye which={which} shape="sad" iris={<Iris which={which} dy={3} />} />
        ))}
        <path
          d="M39 110.5C37 113.5 36 116 37.5 117.5C39 118.8 41 118 41 116C41 114 40 112.5 39 110.5Z"
          fill={c.tear}
          stroke={c.tearLine}
          strokeWidth="0.7"
        />
      </g>
      <g data-variant="sleepy">
        {both(which => (
          <OpenEye which={which} iris={<Iris which={which} dy={3} />} lid={sleepyLid} />
        ))}
      </g>
      <g data-variant="annoyed">
        {both(which => (
          <OpenEye which={which} iris={<Iris which={which} dy={1} />} lid={annoyedLid} />
        ))}
      </g>
      <g data-variant="confused">
        <OpenEye which="left" />
        <OpenEye which="right" iris={<Iris which="right" dy={2} />} lid={sleepyLid} />
      </g>
      <g data-variant="love">
        {both(which => (
          <OpenEye which={which} iris={<Iris which={which} heart />} />
        ))}
      </g>
    </g>
  );
}

function Nose() {
  return (
    <g>
      <ellipse cx="80" cy="118.5" rx="8.5" ry="6" fill="url(#shine)" opacity="0.6" />
      <path
        d="M76.5 108C74.5 113 74.5 117 77 120"
        stroke={c.skinShade}
        strokeWidth="1.3"
        strokeOpacity="0.7"
        strokeLinecap="round"
      />
      <path
        d="M73 118.5Q70.5 122.5 74 125M87 118.5Q89.5 122.5 86 125"
        stroke={c.skinShade}
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path
        d="M74.5 123.2Q76.5 125.2 78.4 123.9M81.6 123.9Q83.5 125.2 85.5 123.2"
        stroke={c.outline}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeOpacity="0.85"
      />
      <ellipse cx="81.5" cy="117" rx="3" ry="1.9" fill="#fff" fillOpacity="0.45" />
    </g>
  );
}

/** Two lips from an upper and lower outline, with the seam and a little gloss. */
function Lips({
  upper,
  lower,
  seam,
  gloss,
}: {
  upper: string;
  lower: string;
  seam: string;
  gloss: [number, number, number];
}) {
  return (
    <g strokeLinejoin="round">
      <path d={upper} fill="url(#upper-lip)" stroke={c.lipDark} strokeWidth="1" />
      <path d={lower} fill="url(#lower-lip)" stroke={c.lipDark} strokeWidth="1" />
      <path d={seam} stroke={c.mouth} strokeWidth="1.3" strokeLinecap="round" fill="none" />
      <ellipse cx={gloss[0]} cy={gloss[1]} rx={gloss[2]} ry="1.6" fill="#fff" fillOpacity="0.6" />
    </g>
  );
}

function OpenMouth({
  cx,
  cy,
  rx,
  ry,
  tongue = true,
}: {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  tongue?: boolean;
}) {
  return (
    <g>
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={c.mouth} stroke={c.lip} strokeWidth="3.4" />
      {tongue && (
        <ellipse cx={cx} cy={cy + ry * 0.5} rx={rx * 0.53} ry={ry * 0.32} fill={c.tongue} />
      )}
      <ellipse
        cx={cx + rx * 0.4}
        cy={cy + ry + 1.4}
        rx={rx * 0.3}
        ry="0.9"
        fill="#fff"
        fillOpacity="0.5"
      />
    </g>
  );
}

const pucker = {
  upper:
    'M72 133C74 129 78 128.5 80 130C82 128.5 86 129 88 133C85 134 83 133.5 80 134.2C77 133.5 75 134 72 133Z',
  lower:
    'M72 133C75 134 77 133.6 80 134.3C83 133.6 85 134 88 133C87 138.5 84 141 80 141C76 141 73 138.5 72 133Z',
  seam: 'M73 133.2C76 134 78 133.8 80 134.2C82 133.8 84 134 87 133.2',
  gloss: [83, 137.5, 2.6] as [number, number, number],
};

function Mouth() {
  return (
    <g data-part="mouth">
      <g data-variant="default">
        <Lips
          upper="M65 132.5C69 127.5 74 125.3 77 126.2C78.5 126.7 79.4 127.6 80 128.4C80.6 127.6 81.5 126.7 83 126.2C86 125.3 91 127.5 95 132.5C90 133 85 132 80 133C75 132 70 133 65 132.5Z"
          lower="M65 132.5C70 133 75 132.3 80 133.1C85 132.3 90 133 95 132.5C93 140.5 87 143.8 80 143.8C73 143.8 67 140.5 65 132.5Z"
          seam="M66 132.6C72 133.6 76 132.5 80 133.3C84 132.5 88 133.6 94 132.6"
          gloss={[84.5, 137.6, 4.6]}
        />
      </g>
      <g data-variant="talk">
        <OpenMouth cx={80} cy={134} rx={9} ry={7.5} />
      </g>
      <g data-variant="happy">
        <path
          d="M61 127C67 125.5 74 126.5 80 127.5C86 126.5 93 125.5 99 127C97 142 89 150 80 150C71 150 63 142 61 127Z"
          fill={c.mouth}
          stroke="url(#lower-lip)"
          strokeWidth="3.4"
          strokeLinejoin="round"
        />
        <path
          d="M64.5 129C70 128.3 75 128.8 80 129.6C85 128.8 90 128.3 95.5 129C95 132 94 134 93 135C88 134 72 134 67 135C66 134 65 132 64.5 129Z"
          fill="#fff"
        />
        <path d="M71 146.5C74 141.5 86 141.5 89 146.5C86 149 74 149 71 146.5Z" fill={c.tongue} />
        <ellipse cx="86" cy="150.2" rx="3.6" ry="1.1" fill="#fff" fillOpacity="0.55" />
      </g>
      <g data-variant="sad">
        <Lips
          upper="M66 139C70 133 75 131 80 131.2C85 131 90 133 94 139C89 137 85 136.3 80 136.6C75 136.3 71 137 66 139Z"
          lower="M66 139C71 137.2 75 136.7 80 137C85 136.7 89 137.2 94 139C91 142 86 143.5 80 143.5C74 143.5 69 142 66 139Z"
          seam="M67 138.8C72 137.3 76 136.8 80 137.1C84 136.8 88 137.3 93 138.8"
          gloss={[84, 140.8, 3]}
        />
      </g>
      <g data-variant="surprised">
        <OpenMouth cx={80} cy={136} rx={6.5} ry={8} tongue={false} />
      </g>
      <g data-variant="sigh">
        <OpenMouth cx={80} cy={135} rx={5} ry={4} tongue={false} />
      </g>
      <g data-variant="sleepy">
        <OpenMouth cx={80} cy={135} rx={4.4} ry={3.2} tongue={false} />
      </g>
      <g data-variant="confused">
        <Lips
          upper="M69 135C72 131.5 76 132 79.5 133.5C83 131 88 130 92 131.5C89 133.5 85 134 80 135C76 135.5 72 135.8 69 135Z"
          lower="M69 135C72 135.8 76 135.5 80 135C85 134 89 133.5 92 131.5C90 137 85 140 79 140C74 140 71 138 69 135Z"
          seam="M70 135C75 135.6 80 135.2 85 134C88 133.2 90 132.3 91 131.8"
          gloss={[83, 137.5, 2.6]}
        />
      </g>
      <g data-variant="love">
        <Lips {...pucker} />
      </g>
      <g data-variant="thinking" transform="translate(4 0)">
        <Lips {...pucker} />
      </g>
      <g data-variant="annoyed">
        <Lips
          upper="M67 135C72 132.8 76 132.6 80 133.4C84 132.6 88 132.8 93 135C88 135.4 84 135.2 80 135.6C76 135.2 72 135.4 67 135Z"
          lower="M67 135C72 135.4 76 135.3 80 135.7C84 135.3 88 135.4 93 135C90 138.2 85 139.2 80 139.2C75 139.2 70 138.2 67 135Z"
          seam="M68 135.1C73 135.5 77 135.4 80 135.7C83 135.4 87 135.5 92 135.1"
          gloss={[84, 137.3, 2.8]}
        />
      </g>
    </g>
  );
}

/** Extras: a hand under the chin while thinking. */
function Extras() {
  return (
    <g data-part="extras">
      <g data-variant="thinking" strokeLinejoin="round">
        <path
          d="M30 158C27 150 30 142 38 138C42 134 48 132 53 133.5C58 132.5 63 134 66 137C71 136.5 76 139 78 142.5C82 143.5 84 147 82 150C79 154 70 155 62 156C54 158 44 162 38 164C34 164 31 162 30 158Z"
          fill="url(#hand)"
          stroke={c.outline}
          strokeWidth="2"
        />
        <path
          d="M53 133.5C55 137 56 140 55 143M66 137C67.5 140 68 143 67 146"
          stroke={c.skinShade}
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </g>
    </g>
  );
}

export function EdiArt() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 170" fill="none">
      <Defs />
      <Head />
      <Cheeks />
      <Brows />
      <Eyes />
      <Nose />
      <Mouth />
      <Extras />
    </svg>
  );
}
