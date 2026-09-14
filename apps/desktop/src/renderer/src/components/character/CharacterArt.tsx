import { useId, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react';
import {
  resolveVariant,
  type CharacterDescriptor,
  type CharacterExpression,
  type CharacterMood,
  type SpeechCue,
} from '@edi/contracts';
import { CharacterEffects } from './CharacterEffects';
import './character.css';

interface CharacterArtProps {
  character: CharacterDescriptor;
  expression?: CharacterExpression;
  mood?: CharacterMood;
  cue?: SpeechCue | null;
  className?: string;
}

/** Small rounded gesture hands, drawn around the shared hand anchors (origin = anchor). */
const hands = {
  left: 'M-6 -9C2 -13 9 -7 8 1C7 9 0 13 -7 11C-13 9 -15 3 -13 -2C-16 -4 -15 -9 -11 -10C-9 -11 -8 -10 -6 -9Z',
  right:
    'M6 -9C-2 -13 -9 -7 -8 1C-7 9 0 13 7 11C13 9 15 3 13 -2C16 -4 15 -9 11 -10C9 -11 8 -10 6 -9Z',
};

/**
 * Draws any character package. The art is the package's sanitized SVG; this component only
 * decides which variant of each part is showing (via @edi/contracts `resolveVariant`) and adds
 * what every character shares: the grab area, the gesture hands and floating effects. All motion
 * lives in character.css, keyed on data-expression, data-mood and data-cue.
 */
export function CharacterArt({
  character,
  expression = 'idle',
  mood = 'neutral',
  cue = null,
  className = '',
}: CharacterArtProps) {
  const { manifest, variants } = character;
  const { viewBox, anchors, bodyPath } = manifest.geometry;
  const scope = `c${useId().replace(/[^\w-]/g, '')}`;
  const markup = useMemo(
    () => character.art.replaceAll('{{scope}}', scope),
    [character.art, scope],
  );
  const layer = useRef<SVGGElement>(null);

  // Show one variant per part. Runs before paint, so a state change never flashes two faces.
  useLayoutEffect(() => {
    const root = layer.current;
    if (!root) return;
    const state = { expression, mood, cue };
    for (const part of root.querySelectorAll('[data-part]')) {
      const options = [...part.children].filter(child => child.hasAttribute('data-variant'));
      if (!options.length) continue;
      const chosen = resolveVariant(
        options.map(option => option.getAttribute('data-variant')!),
        state,
      );
      for (const option of options)
        option.toggleAttribute('data-active', option.getAttribute('data-variant') === chosen);
    }
  }, [markup, expression, mood, cue]);

  return (
    <svg
      className={`pet-art ${className}`}
      data-skin={manifest.id}
      data-expression={expression}
      data-mood={mood}
      data-cue={cue ?? undefined}
      viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
      preserveAspectRatio="xMidYMid meet"
      fill="none"
      role="img"
      aria-label={`${manifest.name} avatar, ${mood === 'neutral' ? expression : `${expression}, ${mood}`}`}
      style={
        { '--motion': manifest.motion.intensity, color: manifest.colors.outline } as CSSProperties
      }
    >
      <g className="pet-character">
        <g className="pet-body" data-blink={manifest.motion.blink || undefined}>
          <g ref={layer} className="pet-art-layer" dangerouslySetInnerHTML={{ __html: markup }} />
          {/* The only grab area: the outline the package declares, not every painted pixel. */}
          <path className="pet-hit" d={bodyPath} fill="transparent" />
          {(['left', 'right'] as const).map(side => {
            const anchor = anchors[side === 'left' ? 'leftHand' : 'rightHand'];
            return (
              <g key={side} data-hand={side} transform={`translate(${anchor.x} ${anchor.y})`}>
                <path
                  className={`pet-hand pet-hand-${side}`}
                  d={hands[side]}
                  fill={manifest.colors.skin}
                  stroke={manifest.colors.outline}
                  strokeWidth="2.6"
                  strokeLinejoin="round"
                />
              </g>
            );
          })}
        </g>
        {manifest.effects && !variants.effects && (
          <CharacterEffects anchors={anchors} state={{ expression, mood, cue }} />
        )}
      </g>
    </svg>
  );
}
