import { useEffect, useState, type CSSProperties } from 'react';
import type {
  ApprovalRequest,
  ArtifactSummary,
  BubbleSide,
  SkinId,
  StatusBubbleState,
} from '@edi/contracts';
import { ArtifactPreview } from '../../components/artifacts/Artifact';
import {
  Button,
  ListeningBars,
  SpeakingBars,
  SpeechBubble,
  ThinkingDots,
} from '../../components/ui';
import { accentFor } from '../../lib/bridge';
import './pet.css';

const announcement = (
  name: string,
): Record<Exclude<StatusBubbleState, 'notice' | 'approval' | 'artifact'>, string> => ({
  unavailable: 'voice coming soon',
  thinking: `${name} is thinking`,
  // Main selects these states only while capture or playback is active.
  listening: 'I’m listening',
  speaking: `${name} is speaking`,
});

interface ApprovalBubbleBridge {
  approval(): Promise<ApprovalRequest | null>;
  subscribeApproval(callback: (approval: ApprovalRequest) => void): () => void;
  respond(callId: string, decision: 'approve' | 'deny'): Promise<void>;
  showContent(): Promise<void>;
  openArtifact(callId: string): Promise<void>;
  subscribeText(callback: (text: string) => void): () => void;
}

const approvalBridge = () => (window as unknown as { ediBubble?: ApprovalBubbleBridge }).ediBubble;

/** A side-of-head state bubble. Ordinary chat text is deliberately not accepted here. */
export function StatusBubble({
  state,
  side,
  skin,
  name,
  text: notice,
  artifact,
}: {
  state: StatusBubbleState;
  side: BubbleSide;
  skin: SkinId;
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

  async function respond(decision: 'approve' | 'deny') {
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
        style={{ '--accent': accentFor(skin) } as CSSProperties}
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
      style={{ '--accent': accentFor(skin) } as CSSProperties}
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
            <section className="bubble-approval" aria-labelledby="bubble-approval-title">
              <p className="ds-eyebrow">{name} needs your OK</p>
              <h2 id="bubble-approval-title">{approval.preview.title}</h2>
              <p>{approval.preview.summary}</p>
              {approval.preview.fields.slice(0, 2).map(field => (
                <div className="bubble-approval-field" key={field.label}>
                  <span>{field.label}</span>
                  <strong>{field.value}</strong>
                </div>
              ))}
              {error && <p role="alert">{error}</p>}
              <div className="bubble-approval-actions">
                <Button size="small" disabled={sending} onClick={() => void showDetails()}>
                  View details
                </Button>
                <Button
                  size="small"
                  variant="prominent"
                  disabled={!armed || sending}
                  onClick={() => void respond('approve')}
                >
                  {approval.preview.action}
                </Button>
              </div>
              <button
                className="bubble-deny"
                disabled={sending}
                onClick={() => void respond('deny')}
              >
                Don’t allow
              </button>
            </section>
          ) : (
            <ThinkingDots />
          )
        ) : (
          <span
            role="status"
            className={
              state === 'unavailable' || state === 'notice' ? 'bubble-reply' : 'ds-visually-hidden'
            }
            title={state === 'unavailable' ? 'No microphone is active' : undefined}
          >
            {staticText}
          </span>
        )}
      </SpeechBubble>
    </div>
  );
}
