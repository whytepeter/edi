import { useEffect, useState, type CSSProperties } from 'react';
import {
  type ApprovalRequest,
  type ArtifactSummary,
  type BubbleSide,
  type StatusBubbleState,
} from '@edi/contracts';
import { ArtifactPreview } from '../../components/artifacts/Artifact';
import { ApprovalCard, type ApprovalDecision } from '../../components/approval/ApprovalCard';
import {
  Button,
  ListeningBars,
  SpeakingBars,
  SpeechBubble,
  ThinkingDots,
} from '../../components/ui';
import './pet.css';

const announcement = (
  name: string,
): Record<Exclude<StatusBubbleState, 'notice' | 'approval' | 'artifact' | 'suggestion'>, string> => ({
  unavailable: 'Set up voice in Settings',
  thinking: `${name} is thinking`,
  // Main selects these states only while capture or playback is active.
  listening: 'I’m listening',
  speaking: `${name} is speaking`,
});

/** One quiet offer: its line and the word on its button. */
interface BubbleSuggestion {
  text: string;
  label: string;
}

interface ApprovalBubbleBridge {
  approval(): Promise<ApprovalRequest | null>;
  suggestion(): Promise<BubbleSuggestion | null>;
  subscribeSuggestion(callback: (suggestion: BubbleSuggestion) => void): () => void;
  respondSuggestion(accept: boolean): Promise<void>;
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
  const [offer, setOffer] = useState<BubbleSuggestion | null>(null);
  useEffect(() => {
    if (state !== 'suggestion') return;
    const bridge = approvalBridge();
    let alive = true;
    void bridge
      ?.suggestion()
      .then(value => alive && setOffer(value))
      .catch(() => {});
    const stop = bridge?.subscribeSuggestion(setOffer);
    return () => {
      alive = false;
      stop?.();
    };
  }, [state]);
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
    state === 'notice'
      ? notice
      : state === 'approval' || state === 'suggestion'
        ? ''
        : announcement(name)[state];
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
        {state === 'suggestion' ? (
          offer ? (
            <div className="bubble-suggestion">
              <p role="status">{offer.text}</p>
              <div className="bubble-suggestion-actions">
                <Button
                  size="small"
                  onClick={() => void approvalBridge()?.respondSuggestion(false)}
                >
                  Not now
                </Button>
                <Button
                  size="small"
                  variant="prominent"
                  onClick={() => void approvalBridge()?.respondSuggestion(true)}
                >
                  {offer.label}
                </Button>
              </div>
            </div>
          ) : (
            <ThinkingDots />
          )
        ) : state === 'approval' ? (
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
