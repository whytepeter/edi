import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { handPaths, handTip, skins, type PresentationAction, type SkinId } from '@edi/contracts';
import { accentFor } from '../../lib/bridge';
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

export function PointerSurface({
  from,
  actions,
  skin,
}: {
  from: Point;
  actions: PresentationAction[];
  skin: SkinId;
}) {
  const pointer = useRef<HTMLDivElement>(null);
  const ink = useRef<SVGSVGElement>(null);
  const position = useRef(from);
  const [arrived, setArrived] = useState(false);
  const [current, setCurrent] = useState(0);
  const action = actions[current];
  const to = action
    ? 'x' in action
      ? { x: action.x, y: action.y }
      : { x: action.x1, y: action.y1 }
    : from;
  const label = action?.label ?? '';

  useEffect(() => {
    const action = actions[current];
    const to = action
      ? 'x' in action
        ? { x: action.x, y: action.y - (action.type === 'circle' ? action.r : 0) }
        : { x: action.x1, y: action.y1 }
      : from;
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
      position.current = to;
      const path = ink.current?.querySelectorAll('path')[current];
      const finish = () => {
        if (current + 1 < actions.length) setCurrent(current + 1);
        else setArrived(true);
      };
      if (!path || action?.type === 'point') {
        finish();
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
  }, [from, actions, current]);

  // Keep the label on screen: flip it left of the point near the right edge.
  const flip = to.x > window.innerWidth - 220;
  return (
    <div
      className="pointer-surface"
      data-accent
      style={
        {
          '--accent': accentFor(skin),
          '--hand-fill': skins.find(item => item.id === skin)!.fill,
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
      <div ref={pointer} className="pointer" aria-hidden="true">
        <svg width="32" height="32" viewBox="-4 -10 32 32" style={{ left: -14, top: -27 }}>
          <path d={handPaths.right} />
        </svg>
      </div>
      {arrived && (
        <>
          <span className="pointer-ping" style={{ left: to.x, top: to.y }} aria-hidden="true" />
          {label && (
            <span
              className="pointer-label ds-bubble ds-glass-thick"
              data-side={flip ? 'left' : 'right'}
              style={{
                left: flip ? undefined : to.x + 18,
                right: flip ? window.innerWidth - to.x + 18 : undefined,
                top: to.y + 12,
              }}
              role="status"
            >
              {label}
            </span>
          )}
        </>
      )}
    </div>
  );
}

/** Only fixed shape commands become SVG, never model-provided markup. */
function drawingPath(action: PresentationAction): string {
  if (action.type === 'point') return `M${action.x} ${action.y}`;
  if (action.type === 'circle') {
    const { x, y, r } = action;
    return `M${x} ${y - r}a${r} ${r} 0 1 1 0 ${2 * r}a${r} ${r} 0 1 1 0 ${-2 * r}`;
  }
  if (action.type === 'box') {
    const { x, y, w, h } = action;
    return `M${x} ${y}h${w}v${h}h${-w}Z`;
  }
  const { x1, y1, x2, y2 } = action;
  let path = `M${x1} ${y1}L${x2} ${y2}`;
  if (action.type === 'arrow') {
    const a = Math.atan2(y2 - y1, x2 - x1);
    const size = Math.min(18, Math.hypot(x2 - x1, y2 - y1) / 3);
    path += `L${x2 - size * Math.cos(a - 0.5)} ${y2 - size * Math.sin(a - 0.5)}L${x2} ${y2}L${x2 - size * Math.cos(a + 0.5)} ${y2 - size * Math.sin(a + 0.5)}`;
  }
  return path;
}
