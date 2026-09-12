import type { ReactNode } from 'react';

interface SpeechBubbleProps {
  /** Which side of the speaker the bubble sits on; its small corner points back. */
  side: 'left' | 'right';
  children: ReactNode;
  className?: string;
}

export function SpeechBubble({ side, children, className = '' }: SpeechBubbleProps) {
  return (
    <div className={`ds-bubble ds-glass-thick ${className}`} data-side={side}>
      {children}
    </div>
  );
}

/** Three dots rising in turn: the speaker is composing a reply. */
export function ThinkingDots() {
  return (
    <span className="ds-thinking" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

/** Level bars: only show while a microphone is actually capturing. */
export function ListeningBars() {
  return (
    <span className="ds-listening listening-bars" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

/** Voice levels: shown while Edi is actively playing a spoken reply. */
export function SpeakingBars() {
  return (
    <span className="ds-speaking speaking-bars" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}
