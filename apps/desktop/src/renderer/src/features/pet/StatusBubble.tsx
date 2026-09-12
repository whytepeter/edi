import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { BubbleSide, SkinId, StatusBubbleState } from '@edi/contracts';
import { ListeningBars, SpeechBubble, ThinkingDots } from '../../components/ui';
import { accentFor } from '../../lib/bridge';
import { nextRevealedText } from './reveal-text';
import './pet.css';

const announcement: Record<Exclude<StatusBubbleState, 'notice'>, string> = {
  unavailable: 'voice coming soon',
  thinking: 'Edi is thinking',
  // Main only selects this state once the capture service confirms a live microphone.
  listening: 'I’m listening',
};

function useRevealedText(incoming: string) {
  const [shown, setShown] = useState('');
  const target = useRef(incoming);
  useEffect(() => {
    target.current = incoming;
  }, [incoming]);
  useEffect(() => {
    const tick = () => {
      const next = target.current;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setShown(next);
        return;
      }
      setShown(current => nextRevealedText(current, next));
    };
    tick();
    const id = window.setInterval(tick, 16);
    return () => window.clearInterval(id);
  }, []);
  return shown;
}

/** A speech bubble beside Edi's head. Display only: this window has no bridge. */
export function StatusBubble({
  state,
  side,
  skin,
  text: notice,
}: {
  state: StatusBubbleState;
  side: BubbleSide;
  skin: SkinId;
  text: string;
}) {
  const [incoming, setIncoming] = useState('');
  const [done, setDone] = useState(true);
  useEffect(() => {
    const bridge = (
      window as unknown as {
        ediBubble?: {
          subscribe: (cb: (update: { text: string; done: boolean }) => void) => () => void;
        };
      }
    ).ediBubble;
    return bridge?.subscribe(update => {
      setIncoming(update.text);
      setDone(update.done);
    });
  }, []);
  const streamed = useRevealedText(incoming);
  const reply = notice && !incoming ? notice : streamed;
  const waiting = state === 'notice' && !reply;
  const streaming = state === 'notice' && Boolean(reply) && (!done || streamed !== incoming);
  const text = state === 'notice' ? reply : announcement[state];
  const visible = state === 'unavailable' || (state === 'notice' && Boolean(reply));
  return (
    <div
      className="status-bubble-surface"
      data-accent
      data-side={side}
      data-state={state}
      style={{ '--accent': accentFor(skin) } as CSSProperties}
    >
      <SpeechBubble side={side}>
        {(state === 'thinking' || waiting) && <ThinkingDots />}
        {state === 'listening' && <ListeningBars />}
        <span
          role="status"
          aria-live={streaming ? 'off' : 'polite'}
          className={visible ? 'bubble-reply' : 'ds-visually-hidden'}
          title={state === 'unavailable' ? 'No microphone is active' : undefined}
        >
          {text}
          {streaming ? <span className="bubble-caret" aria-hidden="true" /> : null}
        </span>
      </SpeechBubble>
    </div>
  );
}
