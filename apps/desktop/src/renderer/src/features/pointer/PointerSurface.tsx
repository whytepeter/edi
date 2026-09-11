import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { SkinId } from '@edi/contracts';
import { accentFor } from '../../lib/bridge';
import './pointer.css';

type Point = { x: number; y: number };

/**
 * Keyframes along a gentle arc from `from` to `to`. The pointer turns to face its
 * direction of travel and swells mid-flight (heyclicky's swoop), so the path itself
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
      transform: `translate(${x}px, ${y}px) rotate(${angle}deg) scale(${scale})`,
      offset: t,
    };
  });
}

export function PointerSurface({
  from,
  to,
  label,
  skin,
}: {
  from: Point;
  to: Point;
  label: string;
  skin: SkinId;
}) {
  const pointer = useRef<HTMLDivElement>(null);
  const [arrived, setArrived] = useState(false);

  useEffect(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const still = `translate(${to.x}px, ${to.y}px) rotate(-45deg)`;
    const animation = pointer.current!.animate(
      reduce
        ? [
            { transform: still, opacity: 0 },
            { transform: still, opacity: 1 },
          ]
        : arc(from, to),
      { duration: reduce ? 150 : 650, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'forwards' },
    );
    animation.onfinish = () => setArrived(true);
    return () => animation.cancel();
  }, [from, to]);

  // Keep the label on screen: flip it left of the point near the right edge.
  const flip = to.x > window.innerWidth - 220;
  return (
    <div
      className="pointer-surface"
      data-accent
      style={{ '--accent': accentFor(skin) } as CSSProperties}
    >
      <div ref={pointer} className="pointer" aria-hidden="true">
        <svg width="34" height="28" viewBox="0 0 34 28">
          <path d="M3 3.5 31 14 3 24.5 9 14Z" />
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
