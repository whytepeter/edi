import { useId } from 'react';
import { skinGeometry, skins, type CharacterExpression, type SkinId } from '@edi/contracts';
import { EdiBehind, EdiChinHand, EdiDefs, EdiFace, ediPalette } from './EdiArt';

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
  const id = useId().replace(/:/g, '');
  const isEdi = skin === 'edi';
  // Edi is soft-shaded with a fine outline; Mochi keeps its flat fill and bold line.
  const fill = isEdi ? `url(#${id}-skin)` : catalogEntry.fill;

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
      {isEdi && <EdiDefs id={id} />}
      <ellipse
        className="pet-shadow"
        cx={isEdi ? 80 : 81}
        cy={isEdi ? 162 : 153}
        rx={isEdi ? 40 : 36}
        ry="5"
        fill="currentColor"
        opacity=".09"
      />
      <g className="pet-character">
        <g
          className="pet-body"
          stroke={isEdi ? ediPalette.outline : 'currentColor'}
          strokeWidth={isEdi ? 2.2 : 3.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* Edi's ears and hoops sit behind the head outline. */}
          {isEdi && <EdiBehind id={id} />}
          {geometry.decorationPath && (
            // Mochi's curled tuft sits behind the head outline.
            <path className="pet-decoration" d={geometry.decorationPath} fill={catalogEntry.fill} />
          )}
          <path className="pet-body-shell" data-part="body" d={geometry.bodyPath} fill={fill} />
          {(['left', 'right'] as const).map(side => {
            const anchor = anchors[side === 'left' ? 'leftHand' : 'rightHand'];
            return (
              <g
                key={side}
                data-part={`${side}-hand`}
                transform={`translate(${anchor.x} ${anchor.y})`}
              >
                <path className={`pet-hand pet-hand-${side}`} d={ediHands[side]} fill={fill} />
              </g>
            );
          })}
          {isEdi ? <EdiFace id={id} head={geometry.bodyPath} /> : <MochiFace />}
          {isEdi && <EdiChinHand id={id} />}
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
