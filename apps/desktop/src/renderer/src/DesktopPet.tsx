import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { petDragThreshold, type Command, type SkinId } from '@edi/contracts';
import { Pet } from './Pet';

interface Gesture { pointerId: number; x: number; y: number; moved: boolean; holding: boolean }

/** Pointer capture keeps the grab stable when Edi's native window moves beneath it. */
export function DesktopPet({ skin, color }: { skin: SkinId; color: string }) {
  const gesture = useRef<Gesture | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const suppressClick = useRef(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const interactive = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');

  async function send(command: Command) {
    try { await window.edi?.command(command); }
    catch { setError('Edi couldn’t complete that action. Try again.'); }
  }

  function hover(value: boolean) {
    if (gesture.current || interactive.current === value) return;
    interactive.current = value;
    void send({ type: 'pet-hit-test', interactive: value });
  }

  function finish(cancel: boolean, event?: PointerEvent<HTMLButtonElement>) {
    const current = gesture.current;
    if (!current || (event && event.pointerId !== current.pointerId)) return;
    clearTimeout(holdTimer.current);
    if (event) current.moved ||= Math.hypot(event.screenX - current.x, event.screenY - current.y) >= petDragThreshold;
    gesture.current = null;
    interactive.current = false;
    suppressClick.current = current.moved || current.holding || cancel;
    if (current.holding) void send({ type: 'release-listening', cancelled: cancel });
    setDragging(false);
    if (!current.holding) void send({ type: 'pet-drag', phase: cancel ? 'cancel' : 'end', pointerId: current.pointerId,
      point: { x: event?.screenX ?? current.x, y: event?.screenY ?? current.y } });
    if (button.current?.hasPointerCapture(current.pointerId)) button.current.releasePointerCapture(current.pointerId);
  }

  useEffect(() => {
    const cancel = () => finish(true);
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && gesture.current) { event.preventDefault(); cancel(); }
    };
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', key);
      cancel();
    };
  }, []);

  return <button
    ref={button}
    className={`desktop-pet${dragging ? ' is-dragging' : ''}`}
    aria-label="Ask Edi to listen"
    title={error || 'Click for conversation. Hold to talk. Drag to move. Right-click for options.'}
    onContextMenu={event => { event.preventDefault(); finish(true); void send({ type: 'character-menu' }); }}
    style={{ color }}
    onPointerDown={event => {
      if (event.button !== 0 || gesture.current) return;
      setError(''); suppressClick.current = false;
      gesture.current = { pointerId: event.pointerId, x: event.screenX, y: event.screenY, moved: false, holding: false };
      event.currentTarget.setPointerCapture(event.pointerId);
      void send({ type: 'pet-drag', phase: 'start', pointerId: event.pointerId,
        point: { x: event.screenX, y: event.screenY } });
      holdTimer.current = setTimeout(() => {
        const current = gesture.current;
        if (!current || current.moved) return;
        current.holding = true;
        void send({ type: 'pet-drag', phase: 'cancel', pointerId: current.pointerId,
          point: { x: current.x, y: current.y } });
        void send({ type: 'request-listening', mode: 'push-to-talk' });
      }, 350);
    }}
    onPointerMove={event => {
      const current = gesture.current;
      if (!current || current.pointerId !== event.pointerId || current.holding) return;
      current.moved ||= Math.hypot(event.screenX - current.x, event.screenY - current.y) >= petDragThreshold;
      if (current.moved) { clearTimeout(holdTimer.current); setDragging(true); }
      void send({ type: 'pet-drag', phase: 'move', pointerId: event.pointerId,
        point: { x: event.screenX, y: event.screenY } });
    }}
    onPointerUp={event => finish(false, event)}
    onPointerCancel={event => finish(true, event)}
    onLostPointerCapture={() => finish(true)}
    onMouseEnter={() => hover(true)}
    onMouseMove={() => hover(true)}
    onMouseLeave={() => hover(false)}
    onClick={event => {
      if (!suppressClick.current || event.detail === 0) void send({ type: 'request-listening', mode: 'conversation' });
    }}
  ><Pet skin={skin}/></button>;
}
