import { useEffect, useState, type CSSProperties } from 'react';
import {
  type ApprovalRequest,
  type ArtifactSummary,
  type BubbleSide,
  type StatusBubbleState,
} from '@edi/contracts';
import { ArtifactPreview } from '../../components/artifacts/Artifact';
import { ApprovalCard, type ApprovalDecision } from '../../components/approval/ApprovalCard';
import { ListeningBars, SpeakingBars, SpeechBubble, ThinkingDots } from '../../components/ui';
import './pet.css';

const announcement = (
  name: string,
): Record<Exclude<StatusBubbleState, 'notice' | 'approval' | 'artifact'>, string> => ({
  unavailable: 'Set up voice in Settings',
  thinking: `${name} is thinking`,
  // Main selects these states only while capture or playback is active.
  listening: 'I’m listening',
  speaking: `${name} is speaking`,
});

interface ApprovalBubbleBridge {
  approval(): Promise<ApprovalRequest | null>;
  subscribeApproval(callback: (approval: ApprovalRequest) => void): () => void;
  respond(callId: string, decision: 'approve' | 'approve-always' | 'deny'): Promise<void>;
  showContent(): Promise<void>;
  openArtifact(callId: string): Promise<void>;
  subscribeText(callback: (text: string) => void): () => void;
}

const approvalBridge = () => (window as unknown as { ediBubble?: ApprovalBubbleBridge }).ediBubble;

/** A side-of-head state bubble. Ordinary chat text is deliberately not accepted here. */
export function StatusBubble({
  state,
  side,
  accent,
  name,
  text: notice,
  artifact,
}: {
  state: StatusBubbleState;
  side: BubbleSide;
  /** The character's accent color, from the URL. */
  accent: string;
  name: string;
  text: string;
  artifact: ArtifactSummary | null;
}) {
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  // Thinking starts with any progress from the URL; updates arrive in place.
  const [progress, setProgress] = useState(state === 'thinking' ? notice : '');
  useEffect(() => {
    if (state !== 'thinking') return;
    return approvalBridge()?.subscribeText(setProgress);
  }, [state]);
  const [armed, setArmed] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const bridge = approvalBridge();
    if (!bridge) return;
    let alive = true;
    const unsubscribe = bridge.subscribeApproval(value => alive && setApproval(value));
    void bridge.approval().then(value => alive && setApproval(value));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (!approval) return;
    const timer = window.setTimeout(() => setArmed(true), 600);
    return () => window.clearTimeout(timer);
  }, [approval]);

  async function respond(decision: ApprovalDecision) {
    if (!approval || sending) return;
    setSending(true);
    setError('');
    try {
      await approvalBridge()?.respond(approval.callId, decision);
    } catch {
      setError('This request is no longer waiting.');
      setSending(false);
    }
  }

  async function showDetails() {
    setError('');
    try {
      await approvalBridge()?.showContent();
    } catch {
      setError('Couldn’t open the full review.');
    }
  }

  if (state === 'artifact')
    return (
      <div
        className="status-bubble-surface"
        data-accent
        data-side={side}
        data-state={state}
        style={{ '--accent': accent } as CSSProperties}
      >
        {artifact ? (
          <ArtifactPreview
            artifact={artifact}
            onOpen={() =>
              void approvalBridge()
                ?.openArtifact(artifact.id)
                .catch(() => {})
            }
          />
        ) : null}
      </div>
    );
  const staticText =
    state === 'notice' ? notice : state === 'approval' ? '' : announcement(name)[state];
  return (
    <div
      className="status-bubble-surface"
      data-accent
      data-side={side}
      data-state={state}
      style={{ '--accent': accent } as CSSProperties}
    >
      <SpeechBubble side={side} className={state === 'approval' ? 'approval-bubble' : ''}>
        {state === 'thinking' && <ThinkingDots />}
        {state === 'thinking' && progress && (
          // Keyed so each new line arrives with the same soft motion.
          <span key={progress} className="bubble-progress" role="status">
            {progress}
          </span>
        )}
        {state === 'listening' && <ListeningBars />}
        {state === 'speaking' && <SpeakingBars />}
        {state === 'approval' ? (
          approval ? (
            <ApprovalCard
              approval={approval}
              compact
              armed={armed}
              sending={sending}
              error={error}
              titleId="bubble-approval-title"
              onRespond={decision => void respond(decision)}
              onDetails={() => void showDetails()}
            />
          ) : (
            <ThinkingDots />
          )
        ) : (
          <span
            role="status"
            className={
              state === 'unavailable' || state === 'notice' ? 'bubble-reply' : 'ds-visually-hidden'
            }
            title={state === 'unavailable' ? 'Settings → Voice' : undefined}
          >
            {staticText}
          </span>
        )}
      </SpeechBubble>
    </div>
  );
}
