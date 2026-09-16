import { useEffect, useRef, useState } from 'react';
import './annotate.css';

interface Stroke {
  id: number;
  points: { x: number; y: number }[];
}

/** A hand's wobble: the same stroke drawn twice, slightly apart, reads as pen on paper. */
function path(points: { x: number; y: number }[], drift: number) {
  return points
    .map((point, index) => {
      const wobble = drift === 0 ? 0 : Math.sin(index * 0.7 + drift) * drift;
      return `${index === 0 ? 'M' : 'L'}${(point.x + wobble).toFixed(1)},${(point.y + wobble * 0.6).toFixed(1)}`;
    })
    .join(' ');
}

/**
 * The person's own marks, over their whole display. While Edi is listening, a drag draws here;
 * the mark stays on screen, so it is in the screenshot Edi takes and Edi can see what they
 * circled. Edi's own hand draws elsewhere (the pointer overlay) and is never captured.
 */
export function AnnotateSurface({ accent }: { accent: string }) {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const drawing = useRef<Stroke | null>(null);
  const next = useRef(1);

  useEffect(() => {
    const finish = () => {
      const stroke = drawing.current;
      drawing.current = null;
      if (!stroke || stroke.points.length < 2) return;
      const xs = stroke.points.map(point => point.x);
      const ys = stroke.points.map(point => point.y);
      const x = Math.round(Math.min(...xs));
      const y = Math.round(Math.min(...ys));
      void window.edi?.command({
        type: 'annotation-drawn',
        x,
        y,
        width: Math.max(1, Math.round(Math.max(...xs)) - x),
        height: Math.max(1, Math.round(Math.max(...ys)) - y),
      });
    };
    const down = (event: PointerEvent) => {
      const stroke = { id: next.current++, points: [{ x: event.clientX, y: event.clientY }] };
      drawing.current = stroke;
      setStrokes(current => [...current.slice(-4), stroke]);
    };
    const move = (event: PointerEvent) => {
      const stroke = drawing.current;
      if (!stroke) return;
      const last = stroke.points.at(-1)!;
      // One point every few pixels: enough for a smooth line, few enough to stay cheap.
      if (Math.hypot(event.clientX - last.x, event.clientY - last.y) < 3) return;
      stroke.points.push({ x: event.clientX, y: event.clientY });
      setStrokes(current => current.map(item => (item.id === stroke.id ? { ...stroke } : item)));
    };
    window.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }, []);

  return (
    <svg className="annotate-surface" aria-hidden="true">
      {strokes.map(stroke => (
        <g key={stroke.id}>
          <path className="annotate-shadow" d={path(stroke.points, 0)} />
          <path className="annotate-ink" d={path(stroke.points, 0)} style={{ stroke: accent }} />
          <path className="annotate-ink" d={path(stroke.points, 1.2)} style={{ stroke: accent }} />
        </g>
      ))}
    </svg>
  );
}
