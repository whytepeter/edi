import { resolveVariant, type CharacterGeometry, type CharacterState } from '@edi/contracts';

type Anchors = CharacterGeometry['anchors'];

/** Effects every character gets for free, placed from the speech anchors beside its head. */
const effects = {
  love: ({ speechRight: at }: Anchors) => (
    <g className="pet-effect pet-effect-float" fill="#e0587a" stroke="none">
      <path
        transform={`translate(${at.x + 6} ${at.y - 2}) scale(0.9)`}
        d="M0 6C-6 1.5-7 -2.5-5 -5C-3 -7.4-.8 -6.6 0 -4.6C.8 -6.6 3 -7.4 5 -5C7 -2.5 6 1.5 0 6Z"
      />
      <path
        transform={`translate(${at.x + 17} ${at.y - 14}) scale(0.62)`}
        d="M0 6C-6 1.5-7 -2.5-5 -5C-3 -7.4-.8 -6.6 0 -4.6C.8 -6.6 3 -7.4 5 -5C7 -2.5 6 1.5 0 6Z"
      />
    </g>
  ),
  sleepy: ({ speechRight: at }: Anchors) => (
    <g
      className="pet-effect pet-effect-float"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={`M${at.x + 2} ${at.y - 2}h6l-6 7h6`} />
      <path d={`M${at.x + 12} ${at.y - 14}h4.5l-4.5 5h4.5`} opacity="0.7" />
    </g>
  ),
  confused: ({ speechLeft: at }: Anchors) => (
    <path
      className="pet-effect pet-effect-wobble"
      d={`M${at.x - 28} ${at.y - 26}c0-5 8-5 8 0c0 3.4-4 3.4-4 7.4M${at.x - 24} ${at.y - 12.4}v.2`}
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
    />
  ),
  surprised: ({ speechRight: at }: Anchors) => (
    <g
      className="pet-effect pet-effect-pop"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
    >
      <path
        d={`M${at.x + 2} ${at.y - 2}l4 -8M${at.x + 8} ${at.y + 5}l8 -3M${at.x - 5} ${at.y - 5}l0 -9`}
      />
    </g>
  ),
  annoyed: ({ speechRight: at }: Anchors) => (
    <g
      className="pet-effect pet-effect-pop"
      transform={`translate(${at.x + 8} ${at.y - 2})`}
      stroke="#d8483f"
      strokeWidth="2.2"
      strokeLinecap="round"
    >
      <path d="M-2 -6c0 3-1 4-4 4M2 -6c0 3 1 4 4 4M-2 6c0-3-1-4-4-4M2 6c0-3 1-4 4-4" />
    </g>
  ),
};
const offered = Object.keys(effects);

/** Floating hearts, z's, a question mark, a surprise burst or an anger mark, by state. */
export function CharacterEffects({ anchors, state }: { anchors: Anchors; state: CharacterState }) {
  // Cues borrow their mood's effect (a gasp looks surprised), like art variants do.
  const chosen = resolveVariant(offered, state) as keyof typeof effects | null;
  if (!chosen) return null;
  return (
    <g key={chosen} className="pet-effects" aria-hidden="true">
      {effects[chosen](anchors)}
    </g>
  );
}
