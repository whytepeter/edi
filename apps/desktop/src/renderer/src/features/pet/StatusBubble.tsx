import type { CSSProperties } from 'react';
import type { BubbleSide, SkinId, StatusBubbleState } from '@edi/contracts';
import { ListeningBars, SpeechBubble, ThinkingDots } from '../../components/ui';
import { accentFor } from '../../lib/bridge';
import './pet.css';

const announcement: Record<Exclude<StatusBubbleState, 'notice'>, string> = {
  unavailable: 'voice coming soon',
  thinking: 'Edi is thinking',
  // Main only selects this state once the capture service confirms a live microphone.
  listening: 'I’m listening',
};

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
  const text = state === 'notice' ? notice || 'Edi' : announcement[state];
  const visible = state === 'unavailable' || state === 'notice';
  return (
    <div
      className="status-bubble-surface"
      data-accent
      data-side={side}
      style={{ '--accent': accentFor(skin) } as CSSProperties}
    >
      <SpeechBubble side={side}>
        {state === 'thinking' && <ThinkingDots />}
        {state === 'listening' && <ListeningBars />}
        <span
          role="status"
          aria-live="polite"
          className={visible ? undefined : 'ds-visually-hidden'}
          title={state === 'unavailable' ? 'No microphone is active' : undefined}
        >
          {text}
        </span>
      </SpeechBubble>
    </div>
  );
}
