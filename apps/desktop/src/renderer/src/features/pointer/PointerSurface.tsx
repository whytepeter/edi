import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { handPaths, handTip, type PresentationAction } from '@edi/contracts';
import './pointer.css';

type Point = { x: number; y: number };

/**
 * Keyframes along a gentle arc from `from` to `to`. The pointer turns to face its
 * direction of travel and swells mid-flight, so the path itself
 * tells you where it is going.
 */
function arc(from: Point, to: Point): Keyframe[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy) || 1;
  const bow = Math.min(distance * 0.3, 160);
  // Bow upwards: pick the perpendicular with the negative y component.
  const normal =
    dy / distance >= 0
      ? { x: dy / distance, y: -dx / distance }
      : { x: -dy / distance, y: dx / distance };
  const control = {
    x: (from.x + to.x) / 2 + normal.x * bow,
    y: (from.y + to.y) / 2 + normal.y * bow,
  };
  const at = (t: number) => ({
    x: (1 - t) ** 2 * from.x + 2 * (1 - t) * t * control.x + t ** 2 * to.x,
    y: (1 - t) ** 2 * from.y + 2 * (1 - t) * t * control.y + t ** 2 * to.y,
  });
  const steps = 20;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    const ahead = at(Math.min(1, t + 0.02));
    const behind = at(Math.max(0, t - 0.02));
    const angle = (Math.atan2(ahead.y - behind.y, ahead.x - behind.x) * 180) / Math.PI;
    const scale = 1 + 0.3 * Math.sin(Math.PI * t);
    const { x, y } = at(t);
    return {
      transform: `translate(${x}px, ${y}px) rotate(${angle - (Math.atan2(handTip.y, handTip.x) * 180) / Math.PI}deg) scale(${scale})`,
      offset: t,
    };
  });
}

/** Where the hand goes before tracing: the first point of the shape's path. */
function startOf(action: PresentationAction): Point {
  switch (action.type) {
    case 'point':
    case 'box':
      return { x: action.x, y: action.y };
    case 'circle':
      return { x: action.x, y: action.y - action.r };
    case 'ellipse':
      return { x: action.x, y: action.y - action.ry };
    default:
      return { x: action.x1, y: action.y1 };
  }
}

/** How far below (or above) a pointed target the fingertip rests, so the target stays readable. */
const REST_GAP = 8;

/**
 * The hand's rest pose at a pointed target: just under it, pointing up, so the hand sits
 * below the line of text instead of across it. Near the bottom edge it points down from above.
 */
function restingPose(at: Point) {
  const below = at.y < window.innerHeight - 70;
  const direction = ((below ? -100 : 100) * Math.PI) / 180;
  return {
    x: at.x,
    y: at.y + (below ? REST_GAP : -REST_GAP),
    angle: ((direction - Math.atan2(handTip.y, handTip.x)) * 180) / Math.PI,
  };
}

/** Where a label hangs: under the target, not at a corner of its shape. */
function focusOf(action: PresentationAction): Point {
  switch (action.type) {
    case 'point':
      return { x: action.x, y: action.y };
    case 'circle':
      return { x: action.x, y: action.y + action.r };
    case 'ellipse':
      return { x: action.x, y: action.y + action.ry };
    case 'box':
      return { x: action.x + action.w / 2, y: action.y + action.h };
    case 'arrow':
      return { x: action.x2, y: action.y2 };
    case 'underline':
      return { x: (action.x1 + action.x2) / 2, y: action.y1 };
  }
}

export function PointerSurface({
  from,
  actions,
  accent,
  hand,
}: {
  from: Point;
  actions: PresentationAction[];
  /** The character's colors, passed by main in the URL. */
  accent: string;
  outline: string;
  hand: string;
}) {
  const pointer = useRef<HTMLDivElement>(null);
  const ink = useRef<SVGSVGElement>(null);
  const position = useRef(from);
  // How many actions have finished; each keeps its label once it is done.
  const [completed, setCompleted] = useState(0);
  const current = Math.min(completed, actions.length - 1);

  useEffect(() => {
    const action = actions[current];
    if (!action || completed >= actions.length) return;
    const to = startOf(action);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const still = `translate(${to.x}px, ${to.y}px) rotate(-45deg)`;
    let frame = 0;
    let cancelled = false;
    const animation = pointer.current!.animate(
      reduce
        ? [
            { transform: still, opacity: 0 },
            { transform: still, opacity: 1 },
          ]
        : arc(position.current, to),
      { duration: reduce ? 150 : 650, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'forwards' },
    );
    animation.onfinish = () => {
      // Keep the arrival pose once the animation is cleaned up, or the hand jumps back.
      animation.commitStyles();
      position.current = to;
      const path = ink.current?.querySelectorAll('path')[current];
      const finish = () => setCompleted(current + 1);
      if (!path || action.type === 'point') {
        // Settle so the hand points up at the target from below instead of covering it.
        const rest = restingPose(to);
        const settle = pointer.current!.animate(
          [{ transform: `translate(${rest.x}px, ${rest.y}px) rotate(${rest.angle}deg)` }],
          { duration: reduce ? 0 : 220, easing: 'ease-out', fill: 'forwards' },
        );
        settle.onfinish = () => {
          if (cancelled) return;
          settle.commitStyles();
          settle.cancel();
          finish();
        };
        return;
      }
      const length = path.getTotalLength();
      path.style.visibility = 'visible';
      const started = performance.now();
      const draw = (now: number) => {
        if (cancelled) return;
        const progress = reduce ? 1 : Math.min(1, (now - started) / 950);
        path.style.strokeDashoffset = String(1 - progress);
        const p = path.getPointAtLength(length * progress);
        position.current = { x: p.x, y: p.y };
        const previous = path.getPointAtLength(Math.max(0, length * progress - 1));
        const angle =
          Math.atan2(p.y - previous.y, p.x - previous.x) - Math.atan2(handTip.y, handTip.x);
        animation.cancel();
        pointer.current!.style.transform = `translate(${p.x}px, ${p.y}px) rotate(${angle}rad)`;
        if (progress < 1) frame = requestAnimationFrame(draw);
        else finish();
      };
      frame = requestAnimationFrame(draw);
    };
    return () => {
      cancelled = true;
      animation.cancel();
      cancelAnimationFrame(frame);
    };
  }, [actions, current, completed]);

  return (
    <div
      className="pointer-surface"
      data-accent
      style={
        {
          '--accent': accent,
          '--hand-fill': hand,
        } as CSSProperties
      }
    >
      <svg ref={ink} className="presentation-ink" aria-hidden="true">
        {actions.map((item, index) => (
          <path
            key={index}
            d={drawingPath(item)}
            pathLength="1"
            strokeDasharray="1"
            strokeDashoffset="1"
          />
        ))}
      </svg>
      {actions.slice(0, completed).map((item, index) => {
        const focus = focusOf(item);
        // Keep labels on screen: flip left near the right edge, above near the bottom.
        const flipX = focus.x > window.innerWidth - 240;
        const flipY = focus.y > window.innerHeight - 70;
        const gap = item.type === 'point' ? 18 : 10;
        return (
          <span key={index}>
            {item.type === 'point' && (
              <span
                className="pointer-ping"
                style={{ left: focus.x, top: focus.y }}
                aria-hidden="true"
              />
            )}
            {item.label && (
              <span
                className="pointer-label ds-bubble ds-glass-thick"
                data-side={flipX ? 'left' : 'right'}
                data-above={flipY || undefined}
                style={{
                  left: flipX ? undefined : focus.x + (item.type === 'point' ? gap : -12),
                  right: flipX
                    ? window.innerWidth - focus.x + (item.type === 'point' ? gap : -12)
                    : undefined,
                  top: flipY ? undefined : focus.y + gap,
                  bottom: flipY ? window.innerHeight - focus.y + gap : undefined,
                }}
                role="status"
              >
                {item.label}
              </span>
            )}
          </span>
        );
      })}
      <div ref={pointer} className="pointer" aria-hidden="true">
        <svg width="32" height="32" viewBox="-4 -10 32 32" style={{ left: -14, top: -27 }}>
          <path d={handPaths.right} />
        </svg>
      </div>
    </div>
  );
}

/** Only fixed shape commands become SVG, never model-provided markup. */
function drawingPath(action: PresentationAction): string {
  switch (action.type) {
    case 'point':
      return `M${action.x} ${action.y}`;
    case 'circle': {
      const { x, y, r } = action;
      return `M${x} ${y - r}a${r} ${r} 0 1 1 0 ${2 * r}a${r} ${r} 0 1 1 0 ${-2 * r}`;
    }
    case 'ellipse': {
      const { x, y, rx, ry } = action;
      return `M${x} ${y - ry}a${rx} ${ry} 0 1 1 0 ${2 * ry}a${rx} ${ry} 0 1 1 0 ${-2 * ry}`;
    }
    case 'box': {
      const { x, y, w, h } = action;
      return `M${x} ${y}h${w}v${h}h${-w}Z`;
    }
    default: {
      const { x1, y1, x2, y2 } = action;
      let path = `M${x1} ${y1}L${x2} ${y2}`;
      if (action.type === 'arrow') {
        const a = Math.atan2(y2 - y1, x2 - x1);
        const size = Math.min(18, Math.hypot(x2 - x1, y2 - y1) / 3);
        path += `L${x2 - size * Math.cos(a - 0.5)} ${y2 - size * Math.sin(a - 0.5)}L${x2} ${y2}L${x2 - size * Math.cos(a + 0.5)} ${y2 - size * Math.sin(a + 0.5)}`;
      }
      return path;
    }
  }
}
