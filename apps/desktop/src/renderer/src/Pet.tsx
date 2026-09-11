import type { SkinId } from '@edi/contracts';

export function Pet({ skin, className = '' }: { skin: SkinId; className?: string }) {
  const sprout = skin === 'sprout';
  return <svg className={`pet-art ${className}`} viewBox="0 0 160 170" fill="none" aria-label={`${sprout ? 'Sprout' : 'Cloud'} avatar`} role="img">
    <ellipse className="pet-shadow" cx="81" cy="153" rx="36" ry="5" fill="currentColor" opacity=".09" />
    <g className="pet-body" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
      {sprout && <path d="M80 39C58 33 57 14 59 12C76 13 86 22 80 39ZM81 39C81 21 96 17 106 20C103 34 96 40 81 39Z" fill="#e2ebe3"/>}
      <path d={sprout ? 'M34 82Q30 40 80 40Q130 40 127 83L123 112Q118 142 80 143Q40 143 36 113Z' : 'M31 91C31 59 51 40 79 40C109 40 131 62 131 91C131 121 109 143 80 143C50 143 31 121 31 91Z'} fill={sprout ? '#f0f5ec' : '#f5f8ff'}/>
      <path d="M30 99C7 92 9 104 22 113C27 115 30 106 30 99ZM132 112C154 106 151 119 142 129C138 129 133 118 132 112Z" fill={sprout ? '#f0f5ec' : '#f5f8ff'}/>
      <g className="pet-eyes"><rect x="57" y="70" width="14" height="33" rx="7"/><rect x="92" y="70" width="14" height="33" rx="7"/></g>
      {sprout && <path d="M75 113Q82 119 89 113" strokeWidth="3"/>}
    </g>
  </svg>;
}
