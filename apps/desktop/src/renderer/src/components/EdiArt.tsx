/**
 * Edi's artwork: a soft-shaded chibi head with a buzz cut, winged eyes, glossy lips and gold
 * hoops. It keeps the shared class names (pet-eyes, pet-pupils, pet-brows, pet-mouths…) so
 * every expression, blink, glance and lip-sync rule in pet.css applies unchanged.
 *
 * Coordinates are in the 160×170 skin viewBox. Right-side parts mirror the left around x = 80
 * by computing points, not by flipping groups, so CSS glances move both pupils the same way.
 */

export const ediPalette = {
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
  goldLight: '#f6d27a',
  gold: '#d6a13a',
  goldDark: '#9c6a1c',
};

const c = ediPalette;
const mirror = (x: number, side: 'left' | 'right') => (side === 'left' ? x : 160 - x);

/** Turns "x,y" pairs in a left-side path into the right side's mirrored path. */
function side(path: string, which: 'left' | 'right') {
  if (which === 'left') return path;
  return path.replace(
    /(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g,
    (_, x, y) => `${160 - Number(x)} ${y}`,
  );
}

/** Gradients and textures, scoped by the caller's unique id. */
export function EdiDefs({ id }: { id: string }) {
  return (
    <defs>
      <radialGradient id={`${id}-skin`} cx="0.4" cy="0.32" r="0.78">
        <stop offset="0" stopColor={c.skinLight} />
        <stop offset="0.55" stopColor={c.skin} />
        <stop offset="1" stopColor={c.skinShade} />
      </radialGradient>
      {/* Hair density falls off toward the face, following the skull's curve. */}
      <radialGradient
        id={`${id}-hair`}
        gradientUnits="userSpaceOnUse"
        cx="0"
        cy="0"
        r="1"
        gradientTransform="translate(80 96) scale(66 76)"
      >
        <stop offset="0.66" stopColor={c.hair} stopOpacity="0" />
        <stop offset="0.86" stopColor={c.hair} stopOpacity="0.34" />
        <stop offset="1" stopColor={c.hair} stopOpacity="0.55" />
      </radialGradient>
      <linearGradient id={`${id}-hair-fade`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0.45" stopColor="#fff" />
        <stop offset="0.64" stopColor="#fff" stopOpacity="0" />
      </linearGradient>
      <radialGradient
        id={`${id}-hair-density`}
        gradientUnits="userSpaceOnUse"
        cx="0"
        cy="0"
        r="1"
        gradientTransform="translate(80 96) scale(66 76)"
      >
        <stop offset="0.7" stopColor="#fff" stopOpacity="0" />
        <stop offset="1" stopColor="#fff" />
      </radialGradient>
      <mask id={`${id}-buzz-mask`} maskContentUnits="userSpaceOnUse">
        <rect x="0" y="0" width="160" height="170" fill={`url(#${id}-hair-density)`} />
      </mask>
      <mask id={`${id}-hair-mask`} maskContentUnits="userSpaceOnUse">
        <rect x="0" y="20" width="160" height="130" fill={`url(#${id}-hair-fade)`} />
      </mask>
      {/* Irregular short hair specks; the tile is small enough to read as texture. */}
      <pattern id={`${id}-buzz`} width="6" height="6" patternUnits="userSpaceOnUse">
        <circle cx="1" cy="1.2" r="0.55" fill={c.hair} />
        <circle cx="4.2" cy="2.4" r="0.5" fill={c.hair} />
        <circle cx="2.6" cy="4.6" r="0.55" fill={c.hair} />
        <circle cx="5.3" cy="5.2" r="0.45" fill={c.hair} />
      </pattern>
      <radialGradient id={`${id}-shine`}>
        <stop offset="0" stopColor="#fff" stopOpacity="0.42" />
        <stop offset="1" stopColor="#fff" stopOpacity="0" />
      </radialGradient>
      <radialGradient id={`${id}-blush`}>
        <stop offset="0" stopColor={c.blush} stopOpacity="0.55" />
        <stop offset="1" stopColor={c.blush} stopOpacity="0" />
      </radialGradient>
      <radialGradient id={`${id}-iris`} cx="0.45" cy="0.6" r="0.6">
        <stop offset="0" stopColor={c.irisLight} />
        <stop offset="0.55" stopColor={c.iris} />
        <stop offset="1" stopColor={c.irisDark} />
      </radialGradient>
      <linearGradient id={`${id}-upper-lip`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={c.lip} />
        <stop offset="1" stopColor={c.lipDark} />
      </linearGradient>
      <radialGradient id={`${id}-lower-lip`} cx="0.55" cy="0.35" r="0.7">
        <stop offset="0" stopColor={c.lipLight} />
        <stop offset="1" stopColor={c.lip} />
      </radialGradient>
      <linearGradient id={`${id}-hand`} x1="0.2" y1="0" x2="0.5" y2="1">
        <stop offset="0" stopColor={c.skinLight} />
        <stop offset="0.5" stopColor={c.skin} />
        <stop offset="1" stopColor={c.skinShade} />
      </linearGradient>
      <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor={c.goldLight} />
        <stop offset="0.5" stopColor={c.gold} />
        <stop offset="1" stopColor={c.goldDark} />
      </linearGradient>
    </defs>
  );
}

/** Hoops and ears sit behind the head outline. */
export function EdiBehind({ id }: { id: string }) {
  return (
    <>
      <g className="pet-earrings" fill="none">
        {(['left', 'right'] as const).map(which => (
          <g key={which}>
            <circle
              cx={mirror(17, which)}
              cy="127"
              r="13.5"
              stroke={c.goldDark}
              strokeWidth="4.4"
            />
            <circle
              cx={mirror(17, which)}
              cy="127"
              r="13.5"
              stroke={`url(#${id}-gold)`}
              strokeWidth="3"
            />
            <path
              d={side('M7 120C9 116 13 114 17 113.5', which)}
              stroke={c.goldLight}
              strokeWidth="1"
              strokeOpacity="0.9"
            />
          </g>
        ))}
      </g>
      {(['left', 'right'] as const).map(which => (
        <g key={which} className="pet-ear">
          <path
            d={side('M26 92C18 86 9 90 9 100C9 109 14 116 22 117C25 117 27 115 28 113Z', which)}
            fill={`url(#${id}-skin)`}
            stroke={c.outline}
            strokeWidth="2"
          />
          <path
            d={side('M22 95C16 94 14 99 15 104C16 108 19 110 22 110', which)}
            stroke={c.skinShade}
            strokeWidth="1.6"
            fill="none"
          />
        </g>
      ))}
    </>
  );
}

/** Soft buzz cut, forehead shine and cheek color, clipped to the head. */
function Skin({ id, head }: { id: string; head: string }) {
  // The hair shade covers the whole head; its gradient and mask decide where it shows.
  const cap = head;
  return (
    <>
      <clipPath id={`${id}-head`}>
        <path d={head} />
      </clipPath>
      <g clipPath={`url(#${id}-head)`} stroke="none">
        <g className="pet-hair" mask={`url(#${id}-hair-mask)`}>
          <path d={cap} fill={`url(#${id}-hair)`} />
          <path d={cap} fill={`url(#${id}-buzz)`} mask={`url(#${id}-buzz-mask)`} opacity="0.45" />
        </g>
        {/* The jaw and cheeks turn away from the light. */}
        <path
          d="M18 96C22 124 46 150 80 150C114 150 138 124 142 96C136 130 112 146 80 146C48 146 24 130 18 96Z"
          fill={c.skinShade}
          opacity="0.35"
        />
      </g>
      <ellipse
        className="pet-shine"
        cx="60"
        cy="44"
        rx="22"
        ry="10"
        transform="rotate(-24 60 44)"
        fill={`url(#${id}-shine)`}
        stroke="none"
      />
      <g className="pet-blush" stroke="none">
        <ellipse cx="41" cy="121" rx="15" ry="10" fill={`url(#${id}-blush)`} />
        <ellipse cx="119" cy="121" rx="15" ry="10" fill={`url(#${id}-blush)`} />
      </g>
    </>
  );
}

/** A feathered brow, thick near the nose and tapering past the arch. */
function Brows() {
  const brow =
    'M70 82C64 76 56 70 47 70.5C40 71 35 75 32 81C38 76 44 74.5 51 75.5C58 76.5 64 79.5 70 84.5Z';
  const hairs = 'M66 79L62 74.5M60 76.5L56.5 72.5M54 74.5L51 71.5M47 73.5L45 71';
  return (
    <g className="pet-brows" stroke="none">
      {(['left', 'right'] as const).map(which => (
        <g key={which}>
          <path d={side(brow, which)} fill={c.brow} />
          <path
            d={side(hairs, which)}
            stroke={c.brow}
            strokeWidth="0.9"
            strokeOpacity="0.7"
            fill="none"
          />
        </g>
      ))}
    </g>
  );
}

/** An almond eye with a lid shadow, winged liner, lashes and two catchlights. */
function Eye({ id, which }: { id: string; which: 'left' | 'right' }) {
  const almond = side('M37 102.5C42 91 62 90 69 104C62 112 44 113 37 102.5Z', which);
  const cx = mirror(53, which);
  const cy = 102;
  const clip = `${id}-eye-${which}`;
  return (
    <>
      {/* Eyeshadow and the crease above the lid. */}
      <path
        d={side('M34 97C40 82 62 80 71 102C63 91 43 89 37 102.5Z', which)}
        fill={c.shadow}
        opacity="0.3"
        stroke="none"
      />
      <path
        d={side('M35 94C41 81 62 79 71 98', which)}
        stroke={c.shadow}
        strokeWidth="0.9"
        strokeOpacity="0.3"
        fill="none"
      />
      <clipPath id={clip}>
        <path d={almond} />
      </clipPath>
      <path d={almond} fill={c.white} stroke="none" />
      <g clipPath={`url(#${clip})`} stroke="none">
        <g className="pet-pupils">
          <circle cx={cx} cy={cy} r="9.6" fill={`url(#${id}-iris)`} />
          <circle cx={cx} cy={cy} r="4.4" fill={c.pupil} />
          <circle cx={cx + 3.6} cy={cy - 3.6} r="2.7" fill="#fff" />
          <circle cx={cx - 3.2} cy={cy + 3.8} r="1.1" fill="#fff" fillOpacity="0.8" />
        </g>
        {/* The upper lid casts a soft shadow across the white and iris. */}
        <path
          d={side('M36 102.5C42 91 62 90 70 104.5C62 97.5 43 96.5 36 102.5Z', which)}
          fill={c.shadow}
          opacity="0.35"
        />
      </g>
      <path
        d={side('M38 102.5C45 112 61 111.5 68 105', which)}
        stroke={c.brow}
        strokeWidth="0.9"
        strokeOpacity="0.6"
        fill="none"
      />
      {/* Liner: thick along the lid, flicking out into a wing. */}
      <path
        d={side(
          'M70 104.5C62 85.5 40 85.5 34 98.5L24.5 93C29 98 33 100.5 37 102.5C42 91 62 90 70 104.5Z',
          which,
        )}
        fill={c.liner}
        stroke={c.liner}
        strokeWidth="0.6"
      />
      {/* Tapered lashes along the outer half of the lid, curling outward. */}
      <path
        d={side(
          'M36.5 95Q33.5 94 30.1 93.8Q33.5 94.9 36 96.5ZM39.7 92.4Q37 90.7 33.7 89.9Q36.8 91.6 38.8 93.8ZM43.5 90.7Q41.2 88.6 38.1 87.3Q40.8 89.4 42.3 91.8ZM47.6 89.9Q45.9 87.4 43.2 85.8Q45.3 88.2 46.3 90.8ZM52 90Q50.9 87.6 48.6 85.9Q50.2 88.2 50.5 90.6ZM56.4 91Q55.8 89.1 53.9 87.6Q55 89.5 54.8 91.4Z',
          which,
        )}
        fill={c.liner}
        stroke="none"
      />
    </>
  );
}

/** Closed, smiling eyes for happy moments, keeping the wing and lashes. */
function HappyEyes() {
  return (
    <g className="pet-eyes-happy" stroke={c.liner} fill="none" strokeLinecap="round">
      {(['left', 'right'] as const).map(which => (
        <g key={which}>
          <path d={side('M37 102Q53 86 69 102', which)} strokeWidth="3.4" />
          <path d={side('M38 101L28 95', which)} strokeWidth="2.6" />
          <path
            d={side('M43 94.5Q39.5 90 36.5 89M50 91Q48.5 86 46 84.5', which)}
            strokeWidth="1.1"
          />
        </g>
      ))}
    </g>
  );
}

function Nose({ id }: { id: string }) {
  return (
    <g className="pet-nose" stroke="none">
      <ellipse cx="80" cy="118.5" rx="8.5" ry="6" fill={`url(#${id}-shine)`} opacity="0.6" />
      <path
        d="M76.5 108C74.5 113 74.5 117 77 120"
        stroke={c.skinShade}
        strokeWidth="1.3"
        strokeOpacity="0.7"
        fill="none"
      />
      <path
        d="M73 118.5Q70.5 122.5 74 125M87 118.5Q89.5 122.5 86 125"
        stroke={c.skinShade}
        strokeWidth="1.2"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M74.5 123.2Q76.5 125.2 78.4 123.9M81.6 123.9Q83.5 125.2 85.5 123.2"
        stroke={c.outline}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeOpacity="0.85"
        fill="none"
      />
      <ellipse cx="81.5" cy="117" rx="3" ry="1.9" fill="#fff" fillOpacity="0.45" />
    </g>
  );
}

/** Full glossy lips at rest, a bright smile, and an open mouth that lip-sync scales. */
function Mouths({ id }: { id: string }) {
  return (
    <g className="pet-mouths">
      <g className="pet-mouth-neutral" strokeLinejoin="round">
        <path
          d="M65 132.5C69 127.5 74 125.3 77 126.2C78.5 126.7 79.4 127.6 80 128.4C80.6 127.6 81.5 126.7 83 126.2C86 125.3 91 127.5 95 132.5C90 133 85 132 80 133C75 132 70 133 65 132.5Z"
          fill={`url(#${id}-upper-lip)`}
          stroke={c.lipDark}
          strokeWidth="1"
        />
        <path
          d="M65 132.5C70 133 75 132.3 80 133.1C85 132.3 90 133 95 132.5C93 140.5 87 143.8 80 143.8C73 143.8 67 140.5 65 132.5Z"
          fill={`url(#${id}-lower-lip)`}
          stroke={c.lipDark}
          strokeWidth="1"
        />
        <path
          d="M66 132.6C72 133.6 76 132.5 80 133.3C84 132.5 88 133.6 94 132.6"
          stroke={c.mouth}
          strokeWidth="1.3"
          fill="none"
        />
        <ellipse
          cx="84.5"
          cy="137.6"
          rx="4.6"
          ry="1.8"
          fill="#fff"
          fillOpacity="0.6"
          stroke="none"
        />
        <ellipse
          cx="75.5"
          cy="129"
          rx="2.2"
          ry="0.9"
          fill="#fff"
          fillOpacity="0.45"
          stroke="none"
        />
      </g>
      {/* A wide open smile: full lips around teeth and a little tongue. */}
      <g className="pet-mouth-happy" strokeLinejoin="round">
        <path
          d="M61 127C67 125.5 74 126.5 80 127.5C86 126.5 93 125.5 99 127C97 142 89 150 80 150C71 150 63 142 61 127Z"
          fill={c.mouth}
          stroke={`url(#${id}-lower-lip)`}
          strokeWidth="3.4"
        />
        <path
          d="M64.5 129C70 128.3 75 128.8 80 129.6C85 128.8 90 128.3 95.5 129C95 132 94 134 93 135C88 134 72 134 67 135C66 134 65 132 64.5 129Z"
          fill="#fff"
          stroke="none"
        />
        <path
          d="M71 146.5C74 141.5 86 141.5 89 146.5C86 149 74 149 71 146.5Z"
          fill={c.tongue}
          stroke="none"
        />
        <ellipse
          cx="86"
          cy="150.2"
          rx="3.6"
          ry="1.1"
          fill="#fff"
          fillOpacity="0.55"
          stroke="none"
        />
      </g>
      <g className="pet-mouth-talk">
        <ellipse cx="80" cy="134" rx="9" ry="7.5" fill={c.mouth} stroke={c.lip} strokeWidth="3.4" />
        <ellipse cx="80" cy="138" rx="4.8" ry="2.4" fill={c.tongue} stroke="none" />
        <ellipse
          cx="83.5"
          cy="140.2"
          rx="2.6"
          ry="0.9"
          fill="#fff"
          fillOpacity="0.5"
          stroke="none"
        />
      </g>
    </g>
  );
}

/** Everything drawn on the head, in front of its outline. */
export function EdiFace({ id, head }: { id: string; head: string }) {
  return (
    <>
      <Skin id={id} head={head} />
      <Brows />
      <g className="pet-eyes">
        <Eye id={id} which="left" />
        <Eye id={id} which="right" />
      </g>
      <HappyEyes />
      <Nose id={id} />
      <Mouths id={id} />
    </>
  );
}

/** Thinking: chin resting on a hand, like the reference pose. Shown only for that mood. */
export function EdiChinHand({ id }: { id: string }) {
  return (
    <g className="pet-chin-hand" stroke={c.outline} strokeWidth="2" strokeLinejoin="round">
      <path
        d="M30 158C27 150 30 142 38 138C42 134 48 132 53 133.5C58 132.5 63 134 66 137C71 136.5 76 139 78 142.5C82 143.5 84 147 82 150C79 154 70 155 62 156C54 158 44 162 38 164C34 164 31 162 30 158Z"
        fill={`url(#${id}-hand)`}
      />
      <path
        d="M53 133.5C55 137 56 140 55 143M66 137C67.5 140 68 143 67 146"
        stroke={c.skinShade}
        strokeWidth="1.4"
        fill="none"
      />
    </g>
  );
}
