/**
 * Mochi: a cream dumpling with a curled tuft, big glossy eyes and pink cheeks. Flat colors and a
 * bold line, so its variants stay simple shapes. Generates `mochi/art.svg`.
 */
import { mirrorX, side, sides, type Side } from './shapes';

const ink = '#71493d';
const face = '#3a2622';
const fill = '#fbf2e8';
const mouth = '#6e2f2f';
const tongue = '#f08c8c';
const cheek = '#f4a6a6';

export const mochiBody =
  'M80 38C108 38 127 60 131 87C134 104 143 114 139 126C135 136 122 139 111 141C97 146 63 146 49 141C38 139 25 136 21 126C17 114 26 104 29 87C33 60 52 38 80 38Z';

/** One oval eye with its highlight, inside the glancing group. */
function Oval({
  which,
  rx = 6.5,
  ry = 9,
  dy = 0,
}: {
  which: Side;
  rx?: number;
  ry?: number;
  dy?: number;
}) {
  const cx = mirrorX(62, which);
  return (
    <>
      <ellipse cx={cx} cy={96 + dy} rx={rx} ry={ry} fill={face} />
      <circle cx={cx + rx * 0.38} cy={91.5 + dy} r={rx * 0.37} fill="#fff" />
    </>
  );
}

function Heart({ which }: { which: Side }) {
  const x = mirrorX(62, which);
  const y = 96;
  return (
    <path
      d={`M${x} ${y + 8}C${x - 8} ${y + 2} ${x - 9} ${y - 3} ${x - 6.5} ${y - 6}C${x - 4} ${y - 8.5} ${x - 1} ${y - 7.5} ${x} ${y - 5}C${x + 1} ${y - 7.5} ${x + 4} ${y - 8.5} ${x + 6.5} ${y - 6}C${x + 9} ${y - 3} ${x + 8} ${y + 2} ${x} ${y + 8}Z`}
      fill="#e25577"
    />
  );
}

const line = { stroke: face, strokeWidth: 3.6, strokeLinecap: 'round' as const, fill: 'none' };

export function MochiArt() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 170" fill="none">
      <ellipse cx="81" cy="153" rx="36" ry="5" fill={ink} opacity="0.09" />
      <g stroke={ink} strokeWidth="3.6" strokeLinejoin="round">
        <path
          d="M62 48C54 36 62 21 79 20C94 19 103 28 99 37C93 31 83 31 76 38C71 43 66 46 62 48ZM80 41C80 31 91 26 101 29C100 38 91 43 80 41Z"
          fill={fill}
        />
        <path d={mochiBody} fill={fill} />
      </g>

      <g data-part="cheeks">
        <g data-variant="default" fill={cheek} opacity="0.55">
          <ellipse cx="46" cy="112" rx="9" ry="5.5" />
          <ellipse cx="114" cy="112" rx="9" ry="5.5" />
        </g>
        <g data-variant="love" fill={cheek} opacity="0.9">
          <ellipse cx="46" cy="112" rx="11" ry="6.5" />
          <ellipse cx="114" cy="112" rx="11" ry="6.5" />
        </g>
      </g>

      {/* Mochi has no brows at rest; they appear only when a mood needs them. */}
      <g data-part="brows">
        <g data-variant="sad" {...line} strokeWidth={3}>
          <path d="M52 83L66 78M94 78L108 83" />
        </g>
        <g data-variant="annoyed" {...line} strokeWidth={3}>
          <path d="M53 78L67 84M93 84L107 78" />
        </g>
        <g data-variant="surprised" {...line} strokeWidth={3}>
          <path d="M53 80Q60 73 68 77M92 77Q100 73 107 80" />
        </g>
        <g data-variant="confused" {...line} strokeWidth={3}>
          <path d="M53 79Q60 73 68 76M92 84L107 82" />
        </g>
      </g>

      <g data-part="eyes">
        <g data-variant="default">
          <g data-part="pupils">
            {sides.map(which => (
              <Oval key={which} which={which} />
            ))}
          </g>
        </g>
        <g data-variant="happy" {...line}>
          <path d="M54 98Q62 88 70 98M90 98Q98 88 106 98" />
        </g>
        <g data-variant="sigh" {...line}>
          <path d="M54 95Q62 102 70 95M90 95Q98 102 106 95" />
        </g>
        <g data-variant="surprised">
          <g data-part="pupils">
            {sides.map(which => (
              <Oval key={which} which={which} rx={8} ry={11} />
            ))}
          </g>
        </g>
        <g data-variant="sad">
          <g data-part="pupils">
            {sides.map(which => (
              <Oval key={which} which={which} dy={2} ry={8} />
            ))}
          </g>
          <path
            d="M55 112C53.5 114.5 53 116.5 54.2 117.7C55.4 118.8 57 118.2 57 116.5C57 115 56.3 113.8 55 112Z"
            fill="#bfe3f5"
            stroke="#6aa9c9"
            strokeWidth="0.8"
          />
        </g>
        <g data-variant="sleepy" {...line}>
          <path d="M54 98Q62 102 70 98M90 98Q98 102 106 98" />
        </g>
        <g data-variant="annoyed">
          <g data-part="pupils">
            {sides.map(which => (
              <Oval key={which} which={which} dy={2} ry={7} />
            ))}
          </g>
          <path
            d={`${side('M53 90L71 93', 'left')}${side('M53 90L71 93', 'right')}`}
            {...line}
            strokeWidth={3}
          />
        </g>
        <g data-variant="confused">
          <g data-part="pupils">
            <Oval which="left" />
          </g>
          <path d="M91 97L105 97" {...line} />
        </g>
        <g data-variant="love">
          <g data-part="pupils">
            {sides.map(which => (
              <Heart key={which} which={which} />
            ))}
          </g>
        </g>
      </g>

      <g data-part="mouth" strokeLinejoin="round">
        <g data-variant="default">
          <path d="M73 113Q80 119 87 113" {...line} strokeWidth={3} />
        </g>
        <g data-variant="talk">
          <ellipse cx="80" cy="116" rx="8" ry="6.5" fill={mouth} stroke={face} strokeWidth="2.4" />
          <ellipse cx="80" cy="119" rx="4.5" ry="2.6" fill={tongue} />
        </g>
        <g data-variant="happy">
          <path
            d="M69 110Q80 128 91 110Q80 114 69 110Z"
            fill={mouth}
            stroke={face}
            strokeWidth="2.6"
          />
          <path d="M74 118Q80 114 86 118Q80 123 74 118Z" fill={tongue} />
        </g>
        <g data-variant="sad">
          <path d="M73 118Q80 111 87 118" {...line} strokeWidth={3} />
        </g>
        <g data-variant="surprised">
          <ellipse cx="80" cy="116" rx="5" ry="6.5" fill={mouth} stroke={face} strokeWidth="2.4" />
        </g>
        <g data-variant="sigh">
          <ellipse cx="80" cy="116" rx="4" ry="3" fill={mouth} stroke={face} strokeWidth="2.2" />
        </g>
        <g data-variant="sleepy">
          <ellipse
            cx="80"
            cy="116"
            rx="3.4"
            ry="2.6"
            fill={mouth}
            stroke={face}
            strokeWidth="2.2"
          />
        </g>
        <g data-variant="confused">
          <path d="M72 115Q76 111 80 115Q84 119 88 115" {...line} strokeWidth={3} />
        </g>
        <g data-variant="love">
          <path d="M73 113Q76.5 117.5 80 113Q83.5 117.5 87 113" {...line} strokeWidth={3} />
        </g>
        <g data-variant="thinking">
          <path d="M77 115Q81 116.5 85 113.5" {...line} strokeWidth={3} />
        </g>
        <g data-variant="annoyed">
          <path d="M73 116L87 116" {...line} strokeWidth={3} />
        </g>
      </g>
    </svg>
  );
}
