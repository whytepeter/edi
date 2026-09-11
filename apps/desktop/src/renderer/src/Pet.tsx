import { skinGeometry, handPaths, type SkinId } from '@edi/contracts';

export function Pet({ skin, className = '' }: { skin: SkinId; className?: string }) {
  const sprout = skin === 'sprout';
  const geometry = skinGeometry[sprout ? 'sprout' : 'cloud'];
  const { viewBox, anchors } = geometry;
  return (
    <svg
      className={`pet-art ${className}`}
      data-skin={sprout ? 'sprout' : 'cloud'}
      viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
      preserveAspectRatio="xMidYMid meet"
      fill="none"
      aria-label={`${sprout ? 'Sprout' : 'Cloud'} avatar`}
      role="img"
    >
      <ellipse
        className="pet-shadow"
        cx="81"
        cy="153"
        rx="36"
        ry="5"
        fill="currentColor"
        opacity=".09"
      />
      <g
        className="pet-body"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {geometry.decorationPath && <path d={geometry.decorationPath} fill="#e2ebe3" />}
        <path data-part="body" d={geometry.bodyPath} fill={sprout ? '#f0f5ec' : '#f5f8ff'} />
        {(['left', 'right'] as const).map(side => {
          const anchor = anchors[side === 'left' ? 'leftHand' : 'rightHand'];
          return (
            <path
              key={side}
              data-part={`${side}-hand`}
              transform={`translate(${anchor.x} ${anchor.y})`}
              d={handPaths[side]}
              fill={sprout ? '#f0f5ec' : '#f5f8ff'}
            />
          );
        })}
        <g className="pet-eyes">
          <rect x="57" y="70" width="14" height="33" rx="7" />
          <rect x="92" y="70" width="14" height="33" rx="7" />
        </g>
        {sprout && <path d="M75 113Q82 119 89 113" strokeWidth="3" />}
      </g>
    </svg>
  );
}
