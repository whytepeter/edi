import { useEffect, useEffectEvent, useRef, useState, type PointerEvent } from 'react';
import {
  petDragThreshold,
  type CharacterDescriptor,
  type CharacterExpression,
  type CharacterMood,
  type Command,
  type SpeechCue,
} from '@edi/contracts';
import { CharacterArt } from '../../components/character/CharacterArt';
import { useAssistantName } from '../../hooks/useAssistantName';

interface Gesture {
  pointerId: number;
  x: number;
  y: number;
  moved: boolean;
  holding: boolean;
}

/** Pointer capture keeps the grab stable when Edi's native window moves beneath it. */
export function DesktopPet({
  character,
  expression,
  mood,
  cue,
}: {
  character: CharacterDescriptor;
  expression: CharacterExpression;
  mood: CharacterMood;
  cue: SpeechCue | null;
}) {
  const assistant = useAssistantName();
  const gesture = useRef<Gesture | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const interactive = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');

  async function send(command: Command) {
    try {
      await window.edi?.command(command);
    } catch {
      setError(`${assistant} couldn’t complete that action. Try again.`);
    }
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
    if (event)
      current.moved ||=
        Math.hypot(event.screenX - current.x, event.screenY - current.y) >= petDragThreshold;
    gesture.current = null;
    interactive.current = false;
    if (current.holding) void send({ type: 'release-listening', cancelled: cancel });
    setDragging(false);
    if (!current.holding)
      void send({
        type: 'pet-drag',
        phase: cancel ? 'cancel' : 'end',
        pointerId: current.pointerId,
        point: { x: event?.screenX ?? current.x, y: event?.screenY ?? current.y },
      });
    if (button.current?.hasPointerCapture(current.pointerId))
      button.current.releasePointerCapture(current.pointerId);
  }

  // Window listeners are registered once; the effect event always sees the latest finish().
  const cancelGesture = useEffectEvent(() => finish(true));
  useEffect(() => {
    const cancel = () => cancelGesture();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && gesture.current) {
        event.preventDefault();
        cancel();
      }
    };
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', key);
      cancel();
    };
  }, []);

  return (
    <button
      ref={button}
      className={`desktop-pet character-live${dragging ? ' is-dragging' : ''}`}
      aria-label={assistant}
      aria-haspopup="menu"
      title={error || 'Hold to talk. Drag to move. Right-click for options.'}
      onContextMenu={event => {
        event.preventDefault();
        finish(true);
        void send({ type: 'character-menu', point: { x: event.screenX, y: event.screenY } });
      }}
      style={{ color: character.manifest.colors.outline }}
      onPointerDown={event => {
        if (event.button !== 0 || gesture.current) return;
        setError('');
        gesture.current = {
          pointerId: event.pointerId,
          x: event.screenX,
          y: event.screenY,
          moved: false,
          holding: false,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        void send({
          type: 'pet-drag',
          phase: 'start',
          pointerId: event.pointerId,
          point: { x: event.screenX, y: event.screenY },
        });
        holdTimer.current = setTimeout(() => {
          const current = gesture.current;
          if (!current || current.moved) return;
          current.holding = true;
          void send({
            type: 'pet-drag',
            phase: 'cancel',
            pointerId: current.pointerId,
            point: { x: current.x, y: current.y },
          });
          void send({ type: 'request-listening', mode: 'push-to-talk' });
        }, 350);
      }}
      onPointerMove={event => {
        const current = gesture.current;
        if (!current || current.pointerId !== event.pointerId || current.holding) return;
        current.moved ||=
          Math.hypot(event.screenX - current.x, event.screenY - current.y) >= petDragThreshold;
        if (current.moved) {
          clearTimeout(holdTimer.current);
          setDragging(true);
        }
        void send({
          type: 'pet-drag',
          phase: 'move',
          pointerId: event.pointerId,
          point: { x: event.screenX, y: event.screenY },
        });
      }}
      onPointerUp={event => finish(false, event)}
      onPointerCancel={event => finish(true, event)}
      onLostPointerCapture={() => finish(true)}
      onMouseEnter={() => hover(true)}
      onMouseMove={() => hover(true)}
      onMouseLeave={() => hover(false)}
      onClick={event => {
        // A mouse click does nothing; keyboard activation opens the options menu.
        if (event.detail === 0) void send({ type: 'character-menu' });
      }}
    >
      <CharacterArt character={character} expression={expression} mood={mood} cue={cue} />
    </button>
  );
}
