import { useId } from 'react';
import { skinGeometry, skins, type CharacterExpression, type SkinId } from '@edi/contracts';

interface PetProps {
  skin: SkinId;
  className?: string;
  expression?: CharacterExpression;
}

/**
 * Declarative character artwork. Main sends only a semantic expression; the
 * active skin owns how eyes, mouth, pose and accents translate that state.
 */
export function Pet({ skin, className = '', expression = 'idle' }: PetProps) {
  const geometry = skinGeometry[skin];
  const { viewBox, anchors } = geometry;
  const catalogEntry = skins.find(entry => entry.id === skin) ?? skins[0];

  return (
    <svg
      className={`pet-art ${className}`}
      data-skin={skin}
      data-expression={expression}
      viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
      preserveAspectRatio="xMidYMid meet"
      fill="none"
      aria-label={`${catalogEntry.name} avatar, ${expression}`}
      role="img"
    >
      <ellipse
        className="pet-shadow"
        cx="81"
        cy={skin === 'edi' ? 156 : 153}
        rx="36"
        ry="5"
        fill="currentColor"
        opacity=".09"
      />
      <g className="pet-character">
        <g
          className="pet-body"
          stroke="currentColor"
          strokeWidth={3.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {skin === 'edi' && (
            // Behind the head, so the hoops hang from under the jaw.
            <g className="pet-earrings" stroke={edi.gold} strokeWidth="3.4">
              <circle cx="21" cy="122" r="11" />
              <circle cx="139" cy="122" r="11" />
            </g>
          )}
          {geometry.decorationPath && (
            // Mochi's curled tuft sits behind the head outline.
            <path className="pet-decoration" d={geometry.decorationPath} fill={catalogEntry.fill} />
          )}
          <path
            className="pet-body-shell"
            data-part="body"
            d={geometry.bodyPath}
            fill={catalogEntry.fill}
          />
          {(['left', 'right'] as const).map(side => {
            const anchor = anchors[side === 'left' ? 'leftHand' : 'rightHand'];
            return (
              <g
                key={side}
                data-part={`${side}-hand`}
                transform={`translate(${anchor.x} ${anchor.y})`}
              >
                <path
                  className={`pet-hand pet-hand-${side}`}
                  d={ediHands[side]}
                  fill={catalogEntry.fill}
                />
              </g>
            );
          })}
          {skin === 'edi' ? <EdiFace /> : <MochiFace />}
        </g>
        <g className="pet-attention" aria-hidden="true">
          <path d="M142 45L148 39" />
          <path d="M145 54L154 52" />
          <circle cx="141" cy="62" r="1.8" fill="currentColor" stroke="none" />
        </g>
      </g>
    </svg>
  );
}

/** Mochi: big glossy eyes, pink cheeks and an open smile on a cream dumpling. */
function MochiFace() {
  const ink = '#3a2622';
  return (
    <>
      <g className="pet-blush" fill="#f4a6a6" opacity=".55" stroke="none">
        <ellipse cx="46" cy="112" rx="9" ry="5.5" />
        <ellipse cx="114" cy="112" rx="9" ry="5.5" />
      </g>
      <g className="pet-eyes" stroke="none">
        <g className="pet-pupils">
          <ellipse cx="62" cy="96" rx="6.5" ry="9" fill={ink} />
          <ellipse cx="98" cy="96" rx="6.5" ry="9" fill={ink} />
          <circle cx="64.5" cy="91.5" r="2.4" fill="#fff" />
          <circle cx="100.5" cy="91.5" r="2.4" fill="#fff" />
        </g>
      </g>
      <g className="pet-eyes-happy" strokeWidth="3.6">
        <path d="M54 98Q62 88 70 98M90 98Q98 88 106 98" />
      </g>
      <g className="pet-mouths">
        <path className="pet-mouth-neutral" d="M73 113Q80 119 87 113" strokeWidth="3" />
        <g className="pet-mouth-happy" strokeWidth="2.6">
          <path d="M69 110Q80 128 91 110Q80 114 69 110Z" fill="#6e2f2f" />
          <path d="M74 118Q80 114 86 118Q80 123 74 118Z" fill="#f08c8c" stroke="none" />
        </g>
        <g className="pet-mouth-talk">
          <ellipse cx="80" cy="116" rx="8" ry="6.5" fill="#6e2f2f" strokeWidth="2.4" />
          <ellipse cx="80" cy="119" rx="4.5" ry="2.6" fill="#f08c8c" stroke="none" />
        </g>
      </g>
    </>
  );
}

/** Edi's small rounded hands, drawn around the shared hand anchors (origin = anchor). */
const ediHands = {
  left: 'M-6 -9C2 -13 9 -7 8 1C7 9 0 13 -7 11C-13 9 -15 3 -13 -2C-16 -4 -15 -9 -11 -10C-9 -11 -8 -10 -6 -9Z',
  right:
    'M6 -9C-2 -13 -9 -7 -8 1C-7 9 0 13 7 11C13 9 15 3 13 -2C16 -4 15 -9 11 -10C9 -11 8 -10 6 -9Z',
};

const edi = {
  blush: '#d97a73',
  white: '#fffaf6',
  iris: '#3a2217',
  pupil: '#140a06',
  lip: '#b35f5d',
  lipLine: '#7c3538',
  lipShine: '#e9a3a0',
  mouth: '#5a1f24',
  gold: '#d6a13a',
};

/** An almond eye with a winged upper lash; the iris is clipped to the eye. */
function EdiEye({ cx, side, clip }: { cx: number; side: -1 | 1; clip: string }) {
  const y = 100;
  const almond = `M${cx - 14} ${y}C${cx - 8} ${y - 12} ${cx + 8} ${y - 12} ${cx + 14} ${y}C${cx + 8} ${y + 9} ${cx - 8} ${y + 9} ${cx - 14} ${y}Z`;
  return (
    <>
      <clipPath id={clip}>
        <path d={almond} />
      </clipPath>
      <path d={almond} fill={edi.white} stroke="none" />
      <g clipPath={`url(#${clip})`}>
        <g className="pet-pupils" stroke="none">
          <circle cx={cx} cy={y + 1} r="7.4" fill={edi.iris} />
          <circle cx={cx} cy={y + 1} r="3.3" fill={edi.pupil} />
          <circle cx={cx + 3} cy={y - 2} r="2.4" fill="#fff" />
        </g>
      </g>
      <path
        d={`M${cx - 14} ${y}C${cx - 8} ${y + 9} ${cx + 8} ${y + 9} ${cx + 14} ${y}`}
        strokeWidth="1.6"
        strokeOpacity=".6"
      />
      <path
        d={`M${cx - 15} ${y + 1}C${cx - 9} ${y - 13} ${cx + 9} ${y - 13} ${cx + 15} ${y - 1}`}
        strokeWidth="4.6"
      />
      <path
        d={`M${cx + side * 14} ${y - 1}C${cx + side * 18} ${y - 3} ${cx + side * 20} ${y - 6} ${cx + side * 21} ${y - 9}`}
        strokeWidth="3.4"
      />
    </>
  );
}

/** Edi: warm brown skin, winged almond eyes, full lips and gold hoops. */
function EdiFace() {
  const id = useId().replace(/:/g, '');
  return (
    <>
      <path
        className="pet-shine"
        d="M42 56C52 40 68 33 86 33"
        stroke="#fff"
        strokeOpacity=".25"
        strokeWidth="5"
      />
      <g className="pet-blush" fill={edi.blush} opacity=".42" stroke="none">
        <circle cx="44" cy="115" r="9" />
        <circle cx="116" cy="115" r="9" />
      </g>
      <path className="pet-brows" d="M40 82Q52 72 66 77M94 77Q108 72 120 82" strokeWidth="2.8" />
      <g className="pet-eyes">
        <EdiEye cx={53} side={-1} clip={`${id}-left`} />
        <EdiEye cx={107} side={1} clip={`${id}-right`} />
      </g>
      <g className="pet-eyes-happy" strokeWidth="3.8">
        <path d="M41 101Q53 90 65 101M95 101Q107 90 119 101" />
        <path d="M41 100L35 95M119 100L125 95" strokeWidth="3" />
      </g>
      <path className="pet-nose" d="M79 108Q77 114 81 115Q84 115 85 113" strokeWidth="2.4" />
      <g className="pet-mouths">
        <g className="pet-mouth-neutral" strokeWidth="2.4">
          <path
            d="M66 127C71 120 77 121 80 123C83 121 89 120 94 127C89 135 71 135 66 127Z"
            fill={edi.lip}
          />
          <path d="M67 127Q80 129 93 127" stroke={edi.lipLine} strokeWidth="1.8" />
          <path d="M83 130Q86 130 88 128.5" stroke={edi.lipShine} strokeWidth="1.8" />
        </g>
        <g className="pet-mouth-happy" strokeWidth="2.6">
          <path d="M66 124Q80 142 94 124Q80 129 66 124Z" fill={edi.mouth} />
          <path d="M70 126Q80 129 90 126" stroke="#fff" strokeWidth="2.4" />
        </g>
        <g className="pet-mouth-talk">
          <ellipse cx="80" cy="128" rx="10" ry="8" fill={edi.lip} strokeWidth="2.4" />
          <ellipse cx="80" cy="128" rx="5.5" ry="4" fill={edi.mouth} stroke="none" />
        </g>
      </g>
    </>
  );
}
